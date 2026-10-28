<?php

$fixture_root = sys_get_temp_dir() . '/npcink-schema-' . uniqid('', true) . '/';
mkdir($fixture_root . 'wp-admin/includes', 0700, true);
file_put_contents($fixture_root . 'wp-admin/includes/upgrade.php', '<?php // dbDelta is supplied by the fixture.');
define('ABSPATH', $fixture_root);
define('NPCINK_DEVICE_INVENTORY_VERSION', '3.2.3');
$options = array();
function get_option($key) { global $options; return isset($options[$key]) ? $options[$key] : false; }
function update_option($key, $value) { global $options; $options[$key] = $value; return true; }
function dbDelta($sql) {
	global $wpdb;
	$wpdb->definitions[] = $sql;
	preg_match('/CREATE TABLE `([^`]+)`/', $sql, $match);
	if (!$wpdb->fail_create) { $wpdb->tables[$match[1]] = true; }
}
class Npcink_Schema_Db {
	public $prefix = 'wp_';
	public $tables = array();
	public $definitions = array();
	public $fail_create = false;
	public $asset_columns = 3;
	public $receipt_columns = 2;
	public $unique_key = 'identity_type,identity_value';
	public $observation_key = 'observation_uuid';
	public function esc_like($value) { return $value; }
	public function prepare($query, ...$args) { return array($query, $args); }
	public function get_var($prepared) {
		list($query, $args) = $prepared;
		if (in_array('payload_hash', $args, true)) { return $this->receipt_columns; }
		if (in_array('observation_uuid', $args, true)) { return $this->observation_key; }
		if (strpos($query, 'INFORMATION_SCHEMA.COLUMNS') !== false) { return $this->asset_columns; }
		return strpos($query, 'SHOW TABLES') !== false ? (isset($this->tables[$args[0]]) ? $args[0] : null) : $this->unique_key;
	}
}
require_once __DIR__ . '/../admin/partials/npcink-device-inventory-admin-interface.php';
require_once __DIR__ . '/../includes/class-npcink-device-inventory-activator.php';
function npcink_schema_assert($condition, $message) { if (!$condition) { throw new RuntimeException($message); } }
try {
	$wpdb = new Npcink_Schema_Db();
	npcink_schema_assert(Npcink_Device_Inventory_Activator::run(), 'Fresh installation must create the current schema.');
	npcink_schema_assert(count($wpdb->definitions) === 4 && count($wpdb->tables) === 4, 'Install must define each business table once.');
	npcink_schema_assert(strpos($wpdb->definitions[0], 'financial_residual_value DECIMAL') !== false && strpos($wpdb->definitions[0], 'latest_observation_id BIGINT') !== false, 'Fresh schema must already contain current value and observation columns.');
	$wpdb->definitions = array();
	npcink_schema_assert(Npcink_Device_Inventory_Activator::run() && !$wpdb->definitions, 'Reactivation must not rebuild a complete current schema.');
	$options['npcink_device_inventory_schema_revision'] = 'obsolete-development-revision';
	npcink_schema_assert(Npcink_Device_Inventory_Activator::run() && count($wpdb->definitions) === 4, 'Revision changes must apply current table definitions without data rewrite migrations.');
	$options = array();
	$wpdb = new Npcink_Schema_Db();
	$wpdb->fail_create = true;
	npcink_schema_assert(!Npcink_Device_Inventory_Activator::run() && !get_option('npcink_device_inventory_schema_revision'), 'Failed table creation must not mark the schema ready.');
	$wpdb = new Npcink_Schema_Db();
	$wpdb->unique_key = '';
	npcink_schema_assert(!Npcink_Device_Inventory_Activator::run() && !get_option('npcink_device_inventory_schema_revision'), 'Missing atomic identity key must prevent the schema being marked ready.');
	$wpdb = new Npcink_Schema_Db();
	$wpdb->asset_columns = 2;
	npcink_schema_assert(!Npcink_Device_Inventory_Activator::run() && !get_option('npcink_device_inventory_schema_revision'), 'Incomplete current asset columns must prevent the schema being marked ready.');
	$wpdb = new Npcink_Schema_Db();
	$wpdb->receipt_columns = 1;
	npcink_schema_assert(!Npcink_Device_Inventory_Activator::run(), 'Incomplete upload receipt columns must not mark schema ready.');
	echo "Current schema fixture checks passed.\n";
} finally {
	unlink($fixture_root . 'wp-admin/includes/upgrade.php');
	rmdir($fixture_root . 'wp-admin/includes');
	rmdir($fixture_root . 'wp-admin');
	rmdir($fixture_root);
}
