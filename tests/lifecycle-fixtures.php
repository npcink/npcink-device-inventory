<?php

$fixture_root = sys_get_temp_dir() . '/npcink-lifecycle-' . uniqid('', true) . '/';
mkdir($fixture_root . 'wp-admin/includes', 0700, true);
file_put_contents($fixture_root . 'wp-admin/includes/upgrade.php', '<?php // Isolated dbDelta is defined by this fixture.');
define('ABSPATH', $fixture_root);
define('NPCINK_DEVICE_INVENTORY_VERSION', '3.2.3');
function plugin_dir_path($path) { return dirname($path) . '/'; }
$options = array();
function get_option($key, $default = false) { global $options; return array_key_exists($key, $options) ? $options[$key] : $default; }
function update_option($key, $value, $autoload = null) { global $options, $option_autoload; $options[$key] = $value; if ($autoload !== null) { $option_autoload[$key] = $autoload; } return true; }
function add_option($key, $value, $deprecated = '', $autoload = true) { global $options, $option_autoload; if (array_key_exists($key, $options)) { return false; } $options[$key] = $value; $option_autoload[$key] = $autoload; return true; }
function delete_option($key) { global $options, $option_autoload; unset($options[$key], $option_autoload[$key]); return true; }
function dbDelta($sql)
{
	global $wpdb;
	preg_match('/CREATE TABLE `([^`]+)`/', $sql, $matches);
	$wpdb->tables[$matches[1]] = true;
}
class Npcink_Lifecycle_Db
{
	public $prefix = 'wp_';
	public $options = 'wp_options';
	public $tables = array();
	public $writes = array();
	public function esc_like($value) { return addcslashes($value, '_%\\'); }
	public function prepare($query, ...$args) { return array($query, $args); }
	public function get_var($prepared)
	{
		list($query, $args) = $prepared;
		if (strpos($query, 'SHOW TABLES') !== false) { $name = stripcslashes($args[0]); return isset($this->tables[$name]) ? $name : null; }
		if (strpos($query, 'SELECT DATA_TYPE') !== false) { return 'longtext'; }
		if (strpos($query, 'COLUMN_NAME IN') !== false) { return in_array('payload_hash', $args, true) ? 2 : 3; }
		if (strpos($query, 'GROUP_CONCAT') !== false) { return in_array('observation_uuid', $args, true) ? 'observation_uuid' : 'identity_type,identity_value'; }
		return 1;
	}
	public function query($query)
	{
		$this->writes[] = $query;
		if (is_array($query) && strpos($query[0], 'DROP TABLE') !== false) { unset($this->tables[$query[1][0]]); }
		if (is_array($query) && strpos($query[0], 'DELETE FROM %i WHERE option_name') !== false) {
			global $options;
			foreach (array_slice($query[1], 1) as $pattern) {
				$prefix = stripcslashes(substr($pattern, 0, -1));
				foreach (array_keys($options) as $key) { if (strpos($key, $prefix) === 0) { unset($options[$key]); } }
			}
		}
		return 1;
	}
}
require_once __DIR__ . '/../admin/partials/npcink-device-inventory-admin-interface.php';
require_once __DIR__ . '/../includes/class-npcink-device-inventory-activator.php';
require_once __DIR__ . '/../includes/v3/class-npcink-device-inventory-v3-tables.php';
require_once __DIR__ . '/../admin/partials/npcink-device-inventory-admin-uninstall.php';
function lifecycle_assert($condition, $message) { if (!$condition) { throw new RuntimeException($message); } }
try {
	$wpdb = new Npcink_Lifecycle_Db();
	$options = array('npcink_device_inventory_schema_revision' => Npcink_Device_Inventory_Activator::SCHEMA_REVISION);
	$option_autoload = array();
	lifecycle_assert(Npcink_Device_Inventory_Activator::run(), 'Activation must repair tables even when an old revision survived.');
	lifecycle_assert(count($wpdb->tables) === 4, 'Activation must create all four missing tables.');
	lifecycle_assert(count($wpdb->writes) === 0, 'Repair must not replay destructive historical migrations.');
	lifecycle_assert(get_option(Npcink_Device_Inventory_V3_Tables::CLIENT_TOKENS_OPTION) === array(), 'Activation must create an empty client token option.');
	lifecycle_assert($option_autoload[Npcink_Device_Inventory_V3_Tables::CLIENT_TOKENS_OPTION] === false, 'Client token option must not autoload.');
	$options['npcink_v3_upload_nonce_test'] = '9999999999';
	$options['npcink_v3_upload_rate_test'] = '1';
	$options['npcinkXv3XuploadXnonce_test'] = 'unrelated';
	Npcink_Device_Inventory_Admin_Uninstall::run();
	lifecycle_assert(count($wpdb->tables) === 4, 'Default uninstall must preserve data.');
	lifecycle_assert(isset($options['npcink_v3_upload_nonce_test']), 'Default uninstall must preserve active replay protections.');
	$options[Npcink_Device_Inventory_V3_Tables::OPTION] = array('delete_data_on_uninstall' => true);
	$options[Npcink_Device_Inventory_V3_Tables::CLIENT_TOKENS_OPTION] = array(array('id' => 'keep-secret', 'secret' => 'lifecycle-secret'));
	Npcink_Device_Inventory_Admin_Uninstall::run();
	lifecycle_assert(count($wpdb->tables) === 0, 'Explicit data deletion must drop all plugin tables.');
	lifecycle_assert(get_option('npcink_device_inventory_schema_revision') === false, 'Data deletion must clear the migration revision.');
	lifecycle_assert(get_option(Npcink_Device_Inventory_V3_Tables::CLIENT_TOKENS_OPTION) === false, 'Data deletion must clear the non-autoloaded client token option.');
	lifecycle_assert(!isset($options['npcink_v3_upload_nonce_test']) && !isset($options['npcink_v3_upload_rate_test']), 'Opt-in uninstall must clear plugin security rows.');
	lifecycle_assert($options['npcinkXv3XuploadXnonce_test'] === 'unrelated', 'LIKE underscores must not match unrelated options.');
	lifecycle_assert(Npcink_Device_Inventory_Activator::run(), 'Reinstall must create the current schema directly.');
	lifecycle_assert(count($wpdb->tables) === 4, 'Reinstall must restore all required tables.');
	lifecycle_assert(get_option('npcink_device_inventory_schema_revision') === Npcink_Device_Inventory_Activator::SCHEMA_REVISION, 'Reinstall must record the current schema baseline.');
	echo "Lifecycle fixture checks passed.\n";
} finally {
	unlink($fixture_root . 'wp-admin/includes/upgrade.php');
	rmdir($fixture_root . 'wp-admin/includes');
	rmdir($fixture_root . 'wp-admin');
	rmdir($fixture_root);
}
