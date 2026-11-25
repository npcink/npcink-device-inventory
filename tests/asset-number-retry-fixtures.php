<?php

define('ABSPATH', __DIR__ . '/');
define('ARRAY_A', 'ARRAY_A');

function sanitize_key($value)
{
	return $value;
}

function sanitize_text_field($value)
{
	return $value;
}

function wp_generate_uuid4()
{
	return '11111111-1111-4111-8111-111111111111';
}

function wp_json_encode($value)
{
	return json_encode($value);
}

function wp_rand($min, $max)
{
	$GLOBALS['npcink_asset_number_rand'] = isset($GLOBALS['npcink_asset_number_rand'])
		? $GLOBALS['npcink_asset_number_rand'] + 1
		: (int) $min;
	return $GLOBALS['npcink_asset_number_rand'];
}

$npcink_asset_cache = array();

function wp_cache_get($key, $group)
{
	$full = $group . ':' . $key;
	return array_key_exists($full, $GLOBALS['npcink_asset_cache']) ? $GLOBALS['npcink_asset_cache'][$full] : false;
}

function wp_cache_set($key, $value, $group, $ttl = 0)
{
	$GLOBALS['npcink_asset_cache'][$group . ':' . $key] = $value;
	return true;
}

class Npcink_Device_Inventory_V3_Sanitizer
{
	public static function json_encode($value)
	{
		return json_encode($value);
	}
}

class Npcink_Device_Inventory_V3_Tables
{
	public static function assets()
	{
		return 'wp_npcink_assets';
	}

	public static function observations()
	{
		return 'wp_npcink_observations';
	}

	public static function options()
	{
		return array('asset_number_prefix' => 'A');
	}

	public static function normalize_department($value)
	{
		return $value;
	}
}

class Npcink_Asset_Number_Retry_Db
{
	public $insert_id = 0;
	public $last_error = '';
	public $fail_remaining = 0;
	public $inserted = array();
	public $rows = array();

	public function insert($table, $row, $formats = array())
	{
		if ($this->fail_remaining > 0) {
			$this->fail_remaining--;
			$this->last_error = "Duplicate entry '" . $row['asset_number'] . "' for key 'asset_number'";
			$this->inserted[] = array('ok' => false, 'asset_number' => $row['asset_number']);
			return false;
		}
		$this->insert_id++;
		$this->last_error = '';
		$row['id'] = $this->insert_id;
		$this->rows[$this->insert_id] = $row;
		$this->inserted[] = array('ok' => true, 'asset_number' => $row['asset_number']);
		return 1;
	}

	public function prepare($query, ...$args)
	{
		return $query;
	}

	public function get_row($query, $output = ARRAY_A)
	{
		$id = $this->insert_id;
		return isset($this->rows[$id]) ? $this->rows[$id] : null;
	}
}

function npcink_asset_input($asset_number = '')
{
	return array(
		'asset_type' => 'computer',
		'asset_number' => $asset_number,
		'name' => 'Fixture laptop',
		'owner_name' => 'Owner',
		'department' => '未分配',
		'status' => 'in_use',
		'category' => 'laptop',
		'purchase_price' => 0,
		'residual_value' => 0,
		'financial_residual_value' => 0,
		'metadata' => array(),
	);
}

require_once __DIR__ . '/../includes/v3/repositories/class-npcink-device-inventory-asset-repository.php';

$wpdb = new Npcink_Asset_Number_Retry_Db();
$repository = new Npcink_Device_Inventory_Asset_Repository();

$wpdb->fail_remaining = 1;
$created = $repository->create(npcink_asset_input());
if (!$created || empty($created['asset_number'])) {
	throw new RuntimeException('A generated asset number conflict must retry and succeed.');
}
if (count($wpdb->inserted) !== 2 || $wpdb->inserted[0]['ok'] || !$wpdb->inserted[1]['ok']) {
	throw new RuntimeException('A generated asset number conflict must retry exactly once before succeeding.');
}
if ($wpdb->inserted[0]['asset_number'] === $wpdb->inserted[1]['asset_number']) {
	throw new RuntimeException('A retry must allocate a different generated asset number.');
}
if ($created['asset_number'] !== $wpdb->inserted[1]['asset_number']) {
	throw new RuntimeException('The created asset must use the retried asset number.');
}

$wpdb = new Npcink_Asset_Number_Retry_Db();
$repository = new Npcink_Device_Inventory_Asset_Repository();
$wpdb->fail_remaining = 1;
if ($repository->create(npcink_asset_input('A-CUSTOM-1')) !== null) {
	throw new RuntimeException('A caller-supplied asset number conflict must not be retried.');
}
if (count($wpdb->inserted) !== 1 || $wpdb->inserted[0]['ok'] || $wpdb->inserted[0]['asset_number'] !== 'A-CUSTOM-1') {
	throw new RuntimeException('A caller-supplied asset number conflict must fail after one insert.');
}
if (!$repository->last_write_was_duplicate_asset_number()) {
	throw new RuntimeException('A caller-supplied asset number conflict must still be reported as a duplicate.');
}

$wpdb = new Npcink_Asset_Number_Retry_Db();
$repository = new Npcink_Device_Inventory_Asset_Repository();
$wpdb->fail_remaining = 5;
if ($repository->create(npcink_asset_input()) !== null) {
	throw new RuntimeException('Generated asset number allocation must stop after five duplicate conflicts.');
}
if (count($wpdb->inserted) !== 5) {
	throw new RuntimeException('Generated asset number allocation must attempt exactly five times.');
}
if (!$repository->last_write_was_duplicate_asset_number()) {
	throw new RuntimeException('Exhausted generated asset number retries must still report a duplicate.');
}

echo "Asset number retry fixture checks passed.\n";
