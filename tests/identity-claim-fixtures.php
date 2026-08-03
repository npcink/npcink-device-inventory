<?php

define('ABSPATH', __DIR__ . '/');
define('ARRAY_A', 'ARRAY_A');

$npcink_identity_cache = array();

function sanitize_key($value)
{
	return strtolower(preg_replace('/[^a-z0-9_\-]/', '', (string) $value));
}

function sanitize_text_field($value)
{
	return trim((string) $value);
}

function wp_json_encode($value)
{
	return json_encode($value);
}

function wp_cache_get($key, $group)
{
	global $npcink_identity_cache;
	$cache_key = $group . ':' . $key;
	return array_key_exists($cache_key, $npcink_identity_cache) ? $npcink_identity_cache[$cache_key] : false;
}

function wp_cache_set($key, $value, $group)
{
	global $npcink_identity_cache;
	$npcink_identity_cache[$group . ':' . $key] = $value;
	return true;
}

class Npcink_Device_Inventory_V3_Tables
{
	public static function identities()
	{
		return 'npcink_asset_identities';
	}
}

class Npcink_Identity_Claim_Fake_Wpdb
{
	public $rows = array();
	public $fail_next_query = false;
	public $found_rows = false;
	public $last_insert_sql = '';

	public function prepare($query, ...$args)
	{
		return array('query' => $query, 'args' => $args);
	}

	public function query($prepared)
	{
		if ($this->fail_next_query) {
			$this->fail_next_query = false;
			return false;
		}
		$query = $prepared['query'];
		$args = $prepared['args'];
		if (strpos($query, 'INSERT INTO') === 0) {
			$this->last_insert_sql = $query;
			$key = $args[2] . ':' . $args[3];
			if (isset($this->rows[$key])) {
				return $this->found_rows ? 1 : 0;
			}
			$this->rows[$key] = array(
				'asset_id' => intval($args[1]),
				'is_primary' => intval($args[5]),
			);
			return 1;
		}
		if (strpos($query, 'UPDATE') === 0) {
			$key = $args[1] . ':' . $args[2];
			$asset_id = intval($args[3]);
			$changed = 0;
			foreach ($this->rows as $row_key => $row) {
				if (intval($row['asset_id']) !== $asset_id) {
					continue;
				}
				$is_primary = $row_key === $key ? 1 : 0;
				if (intval($row['is_primary']) !== $is_primary) {
					$this->rows[$row_key]['is_primary'] = $is_primary;
					$changed++;
				}
			}
			return $changed;
		}
		return false;
	}

	public function get_var($prepared)
	{
		$args = $prepared['args'];
		$key = $args[1] . ':' . $args[2];
		return isset($this->rows[$key]) ? $this->rows[$key]['asset_id'] : null;
	}
}

function npcink_claim_assert($condition, $message)
{
	if (!$condition) {
		fwrite(STDERR, "Identity claim fixture failed: {$message}\n");
		exit(1);
	}
}

$wpdb = new Npcink_Identity_Claim_Fake_Wpdb();
require_once __DIR__ . '/../includes/v3/repositories/class-npcink-device-inventory-identity-repository.php';

$repository = new Npcink_Device_Inventory_Identity_Repository();
$identity = array(
	'type' => 'device_uuid_v1',
	'value' => 'device-v1-example',
	'confidence' => 100,
	'source' => 'fixture',
);

$invalid = $repository->claim(0, $identity);
npcink_claim_assert($invalid['status'] === Npcink_Device_Inventory_Identity_Repository::CLAIM_INVALID, 'invalid asset IDs must be rejected');
$legacy = $repository->claim(11, array('type' => 'stable_device_id_v3', 'value' => 'legacy-value'));
npcink_claim_assert($legacy['status'] === Npcink_Device_Inventory_Identity_Repository::CLAIM_INVALID, 'removed identity types must be rejected');

$inserted = $repository->claim(11, $identity);
npcink_claim_assert($inserted['status'] === Npcink_Device_Inventory_Identity_Repository::CLAIM_INSERTED, 'the first claim must insert the identity');
npcink_claim_assert(strpos($wpdb->last_insert_sql, 'ON DUPLICATE KEY UPDATE') !== false, 'the claim must be atomic at the unique database key');
npcink_claim_assert(strpos($wpdb->last_insert_sql, 'INSERT IGNORE') === false, 'duplicate claims must not be silently ignored');

$owned = $repository->claim(11, $identity, true);
npcink_claim_assert($owned['status'] === Npcink_Device_Inventory_Identity_Repository::CLAIM_OWNED, 'repeating a claim for the owner must be idempotent');
npcink_claim_assert($wpdb->rows['device_uuid_v1:device-v1-example']['is_primary'] === 1, 'an owned identity can be promoted to primary');

$v2_primary = array('type' => 'system_uuid_v2', 'value' => 'system-v2-example', 'confidence' => 100, 'source' => 'fixture');
$repository->claim(11, $v2_primary, true);
npcink_claim_assert($wpdb->rows['system_uuid_v2:system-v2-example']['is_primary'] === 1, 'the new v2 identity must become primary');
npcink_claim_assert($wpdb->rows['device_uuid_v1:device-v1-example']['is_primary'] === 0, 'promoting v2 must demote the legacy primary identity');

$conflict = $repository->claim(22, $identity);
npcink_claim_assert($conflict['status'] === Npcink_Device_Inventory_Identity_Repository::CLAIM_CONFLICT, 'another asset must receive an explicit conflict');
npcink_claim_assert($conflict['ownerAssetId'] === 11, 'a conflict must identify the current owner');

$wpdb->found_rows = true;
$found_rows_conflict = $repository->claim(22, $identity);
npcink_claim_assert($found_rows_conflict['status'] === Npcink_Device_Inventory_Identity_Repository::CLAIM_CONFLICT, 'CLIENT_FOUND_ROWS must not turn another asset claim into an insert');
npcink_claim_assert($found_rows_conflict['ownerAssetId'] === 11, 'CLIENT_FOUND_ROWS conflicts must still report the actual owner');
$wpdb->found_rows = false;

$many = $repository->claim_many(
	22,
	array(
		array('type' => 'fallback_device_v1', 'value' => 'fallback-v1-example'),
		$identity,
	)
);
npcink_claim_assert($many[0]['status'] === Npcink_Device_Inventory_Identity_Repository::CLAIM_INSERTED, 'claim_many must report inserted identities');
npcink_claim_assert($many[1]['status'] === Npcink_Device_Inventory_Identity_Repository::CLAIM_CONFLICT, 'claim_many must preserve secondary conflicts');

$wpdb->fail_next_query = true;
$failed = $repository->claim(33, array('type' => 'device_uuid_v1', 'value' => 'database-error'));
npcink_claim_assert($failed['status'] === Npcink_Device_Inventory_Identity_Repository::CLAIM_ERROR, 'database failures must not be reported as successful claims');

echo "Identity claim fixture checks passed.\n";
