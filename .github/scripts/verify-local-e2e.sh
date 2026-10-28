#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WP_PATH="${WP_PATH:-}"
SITE_URL="${SITE_URL:-}"
DEVICE_NOTE="${DEVICE_NOTE:-HMAC验收}"
WP_CLI_BIN="${WP_CLI_BIN:-}"
WP_CLI_PHP="${WP_CLI_PHP:-}"
WP_CLI_PHP_INI="${WP_CLI_PHP_INI:-}"
TOKEN_ID=""
DEVICE_ID=""
IDENTITY_TYPE=""
ASSET_ID=""

run_wp() {
  if [ -n "${WP_CLI_PHP}" ]; then
    if [ -n "${WP_CLI_PHP_INI}" ]; then
      "${WP_CLI_PHP}" -c "${WP_CLI_PHP_INI}" "${WP_CLI_BIN}" --path="${WP_PATH}" "$@"
    else
      "${WP_CLI_PHP}" "${WP_CLI_BIN}" --path="${WP_PATH}" "$@"
    fi
  else
    "${WP_CLI_BIN}" --path="${WP_PATH}" "$@"
  fi
}

cleanup() {
  local status=$?
  local cleanup_status=0
  trap - EXIT
  if [ -n "${TOKEN_ID}" ] || [ -n "${ASSET_ID}" ]; then
    WP_E2E_TOKEN_ID="${TOKEN_ID}" WP_E2E_ASSET_ID="${ASSET_ID}" WP_E2E_DEVICE_ID="${DEVICE_ID}" WP_E2E_IDENTITY_TYPE="${IDENTITY_TYPE}" run_wp eval '
      $admins = get_users(array("role" => "administrator", "number" => 1, "fields" => "ID"));
      if (!empty($admins)) {
          wp_set_current_user((int) $admins[0]);
      }
      rest_get_server();
      $cleanup_error = null;
      $token_id = getenv("WP_E2E_TOKEN_ID");
      if ($token_id !== "") {
          $request = new WP_REST_Request("DELETE", "/npcink-device-inventory/v1/client-tokens/" . $token_id);
          $request->set_param("id", $token_id);
          $response = rest_do_request($request);
          if (is_wp_error($response) || ($response instanceof WP_REST_Response && $response->get_status() >= 400)) {
              $cleanup_error = new RuntimeException("Failed to delete the temporary client token.");
          }
      }

      $asset_id = (int) getenv("WP_E2E_ASSET_ID");
      $device_id = getenv("WP_E2E_DEVICE_ID");
      $identity_type = getenv("WP_E2E_IDENTITY_TYPE");
      if ($asset_id < 1) {
          if ($cleanup_error) {
              throw $cleanup_error;
          }
          return;
      }
      if ($device_id === "" || $identity_type === "") {
          throw new RuntimeException("Refusing asset cleanup without the submitted identity.");
      }

      global $wpdb;
      $identities = $wpdb->prefix . "npcink_asset_identities";
      $observations = $wpdb->prefix . "npcink_asset_observations";
      $events = $wpdb->prefix . "npcink_asset_events";
      $assets = $wpdb->prefix . "npcink_assets";
      $identity_owner = $wpdb->get_var($wpdb->prepare(
          "SELECT asset_id FROM {$identities} WHERE asset_id = %d AND identity_type = %s AND identity_value = %s LIMIT 1",
          $asset_id,
          $identity_type,
          $device_id
      ));
      if ((int) $identity_owner !== $asset_id) {
          throw new RuntimeException("Refusing asset cleanup because the submitted identity no longer matches the created asset.");
      }

      if ($wpdb->query("START TRANSACTION") === false) {
          throw new RuntimeException("Failed to start the local e2e cleanup transaction.");
      }
      try {
          foreach (array($events, $observations, $identities) as $table) {
              if ($wpdb->delete($table, array("asset_id" => $asset_id), array("%d")) === false) {
                  throw new RuntimeException("Failed to delete local e2e child rows.");
              }
          }
          if ($wpdb->delete($assets, array("id" => $asset_id), array("%d")) !== 1) {
              throw new RuntimeException("Failed to delete the local e2e asset.");
          }
          if ($wpdb->query("COMMIT") === false) {
              throw new RuntimeException("Failed to commit the local e2e cleanup transaction.");
          }
      } catch (Throwable $error) {
          $wpdb->query("ROLLBACK");
          throw $error;
      }
      if ($cleanup_error) {
          throw $cleanup_error;
      }
    ' >/dev/null 2>&1 || cleanup_status=$?
  fi
  if [ "${cleanup_status}" -ne 0 ]; then
    echo "Warning: local e2e cleanup failed; inspect the temporary token and uploaded asset." >&2
    if [ "${status}" -eq 0 ]; then
      status=1
    fi
  fi
  exit "${status}"
}
trap cleanup EXIT

if [ -z "${WP_CLI_BIN}" ]; then
  WP_CLI_BIN="$(command -v wp || true)"
fi

if [ -z "${WP_CLI_BIN}" ] || [ ! -x "${WP_CLI_BIN}" ]; then
  echo "WP-CLI is required for local e2e verification." >&2
  exit 1
fi

if [ -n "${WP_CLI_PHP}" ] && [ ! -x "${WP_CLI_PHP}" ]; then
  echo "Configured WP_CLI_PHP is not executable: ${WP_CLI_PHP}" >&2
  exit 1
fi

if [ -z "${WP_PATH}" ] || [ -z "${SITE_URL}" ]; then
  echo "Set WP_PATH and SITE_URL before running local e2e verification." >&2
  exit 1
fi

if [ ! -d "${WP_PATH}" ]; then
  echo "WordPress path not found: ${WP_PATH}" >&2
  echo "Set WP_PATH=/path/to/local/wp and retry." >&2
  exit 1
fi

if [ ! -d "${ROOT_DIR}/ele-rs" ]; then
  echo "Missing ele-rs desktop uploader source." >&2
  exit 1
fi

echo "Collecting the current device identity..."
pushd "${ROOT_DIR}/ele-rs" >/dev/null
cargo check --locked >/dev/null
DEVICE_ID="$(cargo run --locked --quiet -- device-id)"
popd >/dev/null

case "${DEVICE_ID}" in
  system-v2-*)
    IDENTITY_TYPE="system_uuid_v2"
    ;;
  board-v2-*)
    IDENTITY_TYPE="baseboard_serial_v2"
    ;;
  pci-v2-*)
    IDENTITY_TYPE="pci_permanent_mac_v2"
    ;;
  *)
    echo "Generated device identity has an unexpected format." >&2
    exit 1
    ;;
esac

echo "Checking that the test will not overwrite an existing asset..."
EXISTING_ASSET_ID="$(
  WP_E2E_DEVICE_ID="${DEVICE_ID}" WP_E2E_IDENTITY_TYPE="${IDENTITY_TYPE}" run_wp eval '
    global $wpdb;
    $identities = $wpdb->prefix . "npcink_asset_identities";
    $asset_id = $wpdb->get_var($wpdb->prepare(
        "SELECT asset_id FROM {$identities} WHERE identity_type = %s AND identity_value = %s LIMIT 1",
        getenv("WP_E2E_IDENTITY_TYPE"),
        getenv("WP_E2E_DEVICE_ID")
    ));
    echo $asset_id ? (string) $asset_id : "";
  '
)"
if [ -n "${EXISTING_ASSET_ID}" ]; then
  echo "Refusing to mutate existing asset ${EXISTING_ASSET_ID} for identity type ${IDENTITY_TYPE}." >&2
  exit 1
fi

echo "Generating a temporary local upload authorization code..."
TOKEN="$(
  run_wp eval '
    $admins = get_users(array("role" => "administrator", "number" => 1, "fields" => "ID"));
    if (empty($admins)) {
        fwrite(STDERR, "No administrator user found\n");
        exit(1);
    }
    wp_set_current_user((int) $admins[0]);
    rest_get_server();
    $request = new WP_REST_Request("POST", "/npcink-device-inventory/v1/client-tokens");
    $request->set_header("content-type", "application/json");
    $request->set_body(wp_json_encode(array("name" => "Local E2E")));
    $response = rest_do_request($request);
    $data = $response instanceof WP_REST_Response ? $response->get_data() : $response;
    if (!is_array($data) || empty($data["data"]["id"]) || empty($data["data"]["secret"])) {
        fwrite(STDERR, "Failed to generate client token\n");
        exit(1);
    }
    echo "mda_" . $data["data"]["id"] . "_" . $data["data"]["secret"];
  '
)"

if [[ ! "${TOKEN}" =~ ^mda_[a-z0-9]{12}_[a-f0-9]{64}$ ]]; then
  echo "Generated authorization code has an unexpected format." >&2
  exit 1
fi
TOKEN_ID="$(echo "${TOKEN}" | cut -d _ -f 2)"

echo "Submitting a schema-5 device observation with request signature v2..."
pushd "${ROOT_DIR}/ele-rs" >/dev/null
SUBMIT_RESPONSE="$(
  cargo run --quiet -- submit \
    --site "${SITE_URL%/}" \
    --note "${DEVICE_NOTE}" \
    --token "${TOKEN}"
)"
popd >/dev/null

SUBMIT_SUMMARY="$(
  php -r '
    $response = json_decode(stream_get_contents(STDIN), true);
    $data = is_array($response) && isset($response["data"]) && is_array($response["data"])
      ? $response["data"]
      : array();
    $mode = isset($data["mode"]) && is_string($data["mode"]) ? $data["mode"] : "";
    $asset_id = isset($data["asset"]["id"]) ? (int) $data["asset"]["id"] : 0;
    if ($mode === "" || $asset_id < 1) {
      fwrite(STDERR, "Upload response is missing mode or asset id.\n");
      exit(1);
    }
    echo $mode . "\t" . $asset_id;
  ' <<<"${SUBMIT_RESPONSE}"
)"
IFS=$'\t' read -r SUBMIT_MODE SUBMIT_ASSET_ID <<<"${SUBMIT_SUMMARY}"
if [ "${SUBMIT_MODE}" != "created" ]; then
  echo "Expected the isolated upload to create an asset, got mode=${SUBMIT_MODE}; no asset will be deleted." >&2
  exit 1
fi
ASSET_ID="${SUBMIT_ASSET_ID}"
echo "Upload accepted: mode=${SUBMIT_MODE}, asset_id=${ASSET_ID}, identity_type=${IDENTITY_TYPE}."

echo "Verifying stored v3 observation shape in WordPress..."
WP_E2E_ASSET_ID="${ASSET_ID}" WP_E2E_DEVICE_ID="${DEVICE_ID}" WP_E2E_IDENTITY_TYPE="${IDENTITY_TYPE}" run_wp eval '
  global $wpdb;
  $expected_asset_id = (int) getenv("WP_E2E_ASSET_ID");
  $device_id = getenv("WP_E2E_DEVICE_ID");
  $identity_type = getenv("WP_E2E_IDENTITY_TYPE");
  $identities = $wpdb->prefix . "npcink_asset_identities";
  $observations = $wpdb->prefix . "npcink_asset_observations";
  $asset_id = $wpdb->get_var($wpdb->prepare(
      "SELECT asset_id FROM {$identities} WHERE identity_type = %s AND identity_value = %s LIMIT 1",
      $identity_type,
      $device_id
  ));
  if ((int) $asset_id !== $expected_asset_id) {
      fwrite(STDERR, "Uploaded asset identity does not match the created asset.\n");
      exit(1);
  }
  $row = $wpdb->get_row($wpdb->prepare(
      "SELECT schema_version, summary_json, hardware_json, raw_json FROM {$observations} WHERE asset_id = %d ORDER BY id DESC LIMIT 1",
      $asset_id
  ), ARRAY_A);
  if (!$row) {
      fwrite(STDERR, "Uploaded observation was not found for asset {$asset_id}\n");
      exit(1);
  }
  $raw = json_decode($row["raw_json"], true);
  if ((int) $row["schema_version"] !== 5 || !is_array($raw) || empty($raw["_npcink_device"]) || empty($raw["asset"])) {
      fwrite(STDERR, "Stored observation does not match schema version 5\n");
      exit(1);
  }
  echo "Verified schema version 5 for asset {$asset_id} and identity type {$identity_type}.\n";
'

echo "Local e2e verification passed."
