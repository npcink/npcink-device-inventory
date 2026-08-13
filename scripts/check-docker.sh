#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.test.yml"
PROJECT_NAME="npcink-device-inventory-check-$$-${RANDOM}"
PLUGIN_CHECK_VERSION="${NPCINK_PLUGIN_CHECK_VERSION:-2.0.0}"
PLUGIN_ZIP="${ROOT_DIR}/release/npcink-device-inventory.zip"
SUBMISSION_ZIP="${ROOT_DIR}/sj/npcink-device-inventory.zip"
SUBMISSION_MANIFEST="${ROOT_DIR}/sj/package-manifest.json"
COMPOSE=(docker compose --project-name "${PROJECT_NAME}" --file "${COMPOSE_FILE}")

cleanup() {
  local status=$?
  trap - EXIT
  if [ "${status}" -ne 0 ]; then
    "${COMPOSE[@]}" logs --no-color || true
  fi
  if ! "${COMPOSE[@]}" down --volumes --remove-orphans >/dev/null; then
    echo "Docker cleanup failed for Compose project ${PROJECT_NAME}." >&2
    if [ "${status}" -eq 0 ]; then
      status=1
    fi
  fi
  exit "${status}"
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the isolated WordPress check." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but the daemon is not available." >&2
  exit 1
fi

echo "Building synchronized release and submission ZIPs..."
cd "${ROOT_DIR}"
npm run build:submission
if [ ! -f "${PLUGIN_ZIP}" ] || [ ! -f "${SUBMISSION_ZIP}" ] || [ ! -f "${SUBMISSION_MANIFEST}" ]; then
  echo "Release ZIP, submission ZIP, or submission manifest was not created." >&2
  exit 1
fi

node --input-type=module --eval '
  import { execFileSync } from "node:child_process";
  import { createHash } from "node:crypto";
  import { readFileSync, statSync } from "node:fs";
  const [releasePath, submissionPath, manifestPath] = process.argv.slice(1);
  const release = readFileSync(releasePath);
  const submission = readFileSync(submissionPath);
  if (!release.equals(submission)) {
    throw new Error("Release and submission ZIPs differ.");
  }
  const entries = execFileSync("unzip", ["-Z1", submissionPath], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
  const listing = execFileSync("unzip", ["-l", submissionPath], { encoding: "utf8" });
  const listedEntries = Array.from(
    listing.matchAll(/^\s*(\d+)\s+\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}\s+(.+)$/gm)
  );
  const actual = {
    sha256: createHash("sha256").update(submission).digest("hex"),
    entry_count: entries.length,
    file_count: entries.filter((entry) => !entry.endsWith("/")).length,
    uncompressed_bytes: listedEntries.reduce((total, match) => total + Number(match[1]), 0),
    compressed_bytes: statSync(submissionPath).size,
  };
  const expected = JSON.parse(readFileSync(manifestPath, "utf8")).package || {};
  for (const [field, value] of Object.entries(actual)) {
    if (expected[field] !== value) {
      throw new Error(`Submission manifest mismatch for ${field}: expected=${expected[field]} actual=${value}`);
    }
  }
  console.log(`Submission package synchronized: ${actual.sha256}`);
' "${PLUGIN_ZIP}" "${SUBMISSION_ZIP}" "${SUBMISSION_MANIFEST}"

echo "Starting isolated WordPress PHP 8.3 and MariaDB 11 services..."
"${COMPOSE[@]}" up --detach --wait database wordpress

run_wp() {
  "${COMPOSE[@]}" run --rm cli "$@"
}

echo "Installing WordPress and the release ZIP..."
run_wp core install \
  --url="http://wordpress" \
  --title="Npcink Device Inventory Docker Check" \
  --admin_user="npcink-e2e-admin" \
  --admin_password="npcink-e2e-password" \
  --admin_email="e2e@example.invalid" \
  --skip-email
run_wp plugin install /workspace/release/npcink-device-inventory.zip --activate

wordpress_version="$(run_wp core version)"
php_version="$(run_wp eval 'echo PHP_MAJOR_VERSION . "." . PHP_MINOR_VERSION;')"
if [ "${php_version}" != "8.3" ]; then
  echo "Expected PHP 8.3, found ${php_version}." >&2
  exit 1
fi
echo "WordPress ${wordpress_version}, PHP ${php_version}."

echo "Installing official Plugin Check ${PLUGIN_CHECK_VERSION}..."
run_wp plugin install "https://downloads.wordpress.org/plugin/plugin-check.${PLUGIN_CHECK_VERSION}.zip" --activate
installed_plugin_check_version="$(run_wp plugin get plugin-check --field=version)"
if [ "${installed_plugin_check_version}" != "${PLUGIN_CHECK_VERSION}" ]; then
  echo "Expected Plugin Check ${PLUGIN_CHECK_VERSION}, found ${installed_plugin_check_version}." >&2
  exit 1
fi

echo "Running official Plugin Check against the installed release ZIP..."
plugin_check_output="$(run_wp plugin check npcink-device-inventory --format=table 2>&1)"
printf '%s\n' "${plugin_check_output}"
if ! grep -Fq "Checks complete. No errors found." <<<"${plugin_check_output}"; then
  echo "Plugin Check reported errors or warnings." >&2
  exit 1
fi

echo "Verifying real MariaDB nonce replay and rate-limit boundaries..."
run_wp eval '
  $options = get_option("npcink_device_inventory_v3_options");
  $options["client_tokens"] = array(array(
    "id" => "docker-agent",
    "secret" => "docker-secret",
    "enabled" => true,
  ));
  update_option("npcink_device_inventory_v3_options", $options);
  $auth = new Npcink_Device_Inventory_Token_Auth_Service();
  $body = "{\"summary\":{\"hostname\":\"docker\"}}";
  $timestamp = (string) time();
  $verify = static function ($nonce) use ($auth, $body, $timestamp) {
    $payload = $timestamp . "\n" . $nonce . "\n" . hash("sha256", $body);
    $request = new WP_REST_Request("POST", "/");
    $request->set_body($body);
    $request->set_header("x-npcink-device-token-id", "docker-agent");
    $request->set_header("x-npcink-device-timestamp", $timestamp);
    $request->set_header("x-npcink-device-nonce", $nonce);
    $request->set_header("x-npcink-device-signature", "sha256=" . hash_hmac("sha256", $payload, "docker-secret"));
    return $auth->verify_request($request);
  };
  $first = $verify("replay");
  if ($first !== true) {
	$detail = is_wp_error($first) ? $first->get_error_code() . ": " . $first->get_error_message() : gettype($first);
	throw new RuntimeException("First nonce claim failed: " . $detail);
  }
  $replay = $verify("replay");
  if (!is_wp_error($replay) || $replay->get_error_code() !== "replayed_nonce") {
    throw new RuntimeException("Nonce replay was not rejected.");
  }
  for ($index = 0; $index < Npcink_Device_Inventory_Token_Auth_Service::RATE_LIMIT - 1; $index++) {
    if ($verify("rate-" . $index) !== true) {
      throw new RuntimeException("Rate-limit boundary rejected too early at " . $index . ".");
    }
  }
  $limited = $verify("rate-over");
  if (!is_wp_error($limited) || $limited->get_error_code() !== "upload_rate_limited") {
    throw new RuntimeException("Rate limit did not reject request 121.");
  }
  global $wpdb;
  $nonce_rows = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name LIKE '\''npcink_v3_upload_nonce_%'\''");
  $rate_rows = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name LIKE '\''npcink_v3_upload_rate_%'\''");
  if ($nonce_rows < 121 || $rate_rows !== 1) {
    throw new RuntimeException("Unexpected atomic option rows: nonce={$nonce_rows}, rate={$rate_rows}.");
  }
  echo "MariaDB upload security boundary verified.\n";
'

echo "Running the real backup restore rehearsal..."
run_wp eval '
  global $wpdb;
  $created = $wpdb->insert(
    $wpdb->prefix . "npcink_assets",
    array(
      "uuid" => wp_generate_uuid4(),
      "asset_type" => "custom",
      "asset_number" => "RESTORE-E2E-SENTINEL",
      "name" => "Cleanup scope sentinel"
    ),
    array("%s", "%s", "%s", "%s")
  );
  if ($created !== 1) {
    fwrite(STDERR, "Failed to create the cleanup scope sentinel.\n");
    exit(1);
  }
'
"${COMPOSE[@]}" run --rm \
  --env NPCINK_RESTORE_REHEARSAL_ROOT=/workspace \
  cli eval-file /workspace/scripts/wp-backup-restore-rehearsal.php
run_wp eval '
  global $wpdb;
  $table = $wpdb->prefix . "npcink_assets";
  $sentinel_id = $wpdb->get_var($wpdb->prepare(
    "SELECT id FROM {$table} WHERE asset_number = %s LIMIT 1",
    "RESTORE-E2E-SENTINEL"
  ));
  if (!$sentinel_id) {
    fwrite(STDERR, "Backup restore cleanup deleted an unrelated sentinel asset.\n");
    exit(1);
  }
  if ($wpdb->delete($table, array("id" => (int) $sentinel_id), array("%d")) !== 1) {
    fwrite(STDERR, "Failed to remove the cleanup scope sentinel.\n");
    exit(1);
  }
'

echo "Verifying multisite upgrade migration across all sites..."
run_wp plugin deactivate npcink-device-inventory
run_wp core multisite-convert --title="Npcink Device Inventory Network"
run_wp site create --slug=branch-one --title="Branch One" --email=e2e@example.invalid
run_wp site create --slug=branch-two --title="Branch Two" --email=e2e@example.invalid
run_wp plugin activate npcink-device-inventory --network
run_wp eval '
  $origin = get_current_blog_id();
  foreach (get_sites(array("fields" => "ids", "number" => 0)) as $site_id) {
    switch_to_blog((int) $site_id);
    delete_option("npcink_device_inventory_schema_revision");
    delete_option("npcink_device_inventory_plugin_version");
    restore_current_blog();
  }
  npcink_device_inventory_upgrade_after_update(null, array(
    "action" => "update",
    "type" => "plugin",
    "plugins" => array(plugin_basename(WP_PLUGIN_DIR . "/npcink-device-inventory/npcink-device-inventory.php")),
  ));
  if (get_current_blog_id() !== $origin) {
    throw new RuntimeException("Multisite upgrade did not restore the original blog.");
  }
  global $wpdb;
  foreach (get_sites(array("fields" => "ids", "number" => 0)) as $site_id) {
    switch_to_blog((int) $site_id);
    $revision = get_option("npcink_device_inventory_schema_revision");
    $version = get_option("npcink_device_inventory_plugin_version");
    $missing = array();
    foreach (array("npcink_assets", "npcink_asset_identities", "npcink_asset_observations", "npcink_asset_events") as $suffix) {
      $table = $wpdb->prefix . $suffix;
      if ($wpdb->get_var($wpdb->prepare("SHOW TABLES LIKE %s", $table)) !== $table) {
        $missing[] = $table;
      }
    }
    restore_current_blog();
    if ($revision !== Npcink_Device_Inventory_Activator::SCHEMA_REVISION || $version !== NPCINK_DEVICE_INVENTORY_VERSION || $missing) {
      throw new RuntimeException("Multisite migration failed for site {$site_id}: revision={$revision}, version={$version}, missing=" . implode(",", $missing));
    }
  }
  echo "Multisite upgrade migration verified.\n";
'

echo "Isolated Docker verification passed."
