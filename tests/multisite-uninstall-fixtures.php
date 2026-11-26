<?php

$fixture_root = sys_get_temp_dir() . '/npcink-multisite-uninstall-' . uniqid('', true) . '/';
mkdir($fixture_root, 0700, true);
define('ABSPATH', $fixture_root);

$npcink_origin_blog = 1;
$npcink_current_blog = 1;
$npcink_blogs = array();

function plugin_dir_path($path)
{
	return dirname($path) . '/';
}

function is_multisite()
{
	return true;
}

function get_sites($args = array())
{
	global $npcink_blogs;
	return array_map('intval', array_keys($npcink_blogs));
}

function switch_to_blog($id)
{
	global $npcink_current_blog, $wpdb, $npcink_blogs;
	$id = (int) $id;
	if (!isset($npcink_blogs[$id])) {
		throw new RuntimeException('Unknown blog ' . $id);
	}
	$npcink_current_blog = $id;
	$wpdb->prefix = $npcink_blogs[$id]['prefix'];
	$wpdb->options = $npcink_blogs[$id]['options_table'];
	return true;
}

function restore_current_blog()
{
	global $npcink_origin_blog;
	return switch_to_blog($npcink_origin_blog);
}

function get_option($key, $default = false)
{
	global $npcink_blogs, $npcink_current_blog;
	$options = $npcink_blogs[$npcink_current_blog]['options'];
	return array_key_exists($key, $options) ? $options[$key] : $default;
}

function update_option($key, $value, $autoload = null)
{
	global $npcink_blogs, $npcink_current_blog;
	$npcink_blogs[$npcink_current_blog]['options'][$key] = $value;
	return true;
}

function add_option($key, $value, $deprecated = '', $autoload = true)
{
	global $npcink_blogs, $npcink_current_blog;
	if (array_key_exists($key, $npcink_blogs[$npcink_current_blog]['options'])) {
		return false;
	}
	$npcink_blogs[$npcink_current_blog]['options'][$key] = $value;
	return true;
}

function delete_option($key)
{
	global $npcink_blogs, $npcink_current_blog;
	unset($npcink_blogs[$npcink_current_blog]['options'][$key]);
	return true;
}

class Npcink_Multisite_Uninstall_Db
{
	public $prefix = 'wp_';
	public $options = 'wp_options';
	public $writes = array();

	public function esc_like($value)
	{
		return addcslashes((string) $value, '_%\\');
	}

	public function prepare($query, ...$args)
	{
		return array($query, $args);
	}

	public function get_var($prepared)
	{
		list($query, $args) = $prepared;
		if (strpos($query, 'SHOW TABLES') !== false) {
			global $npcink_blogs, $npcink_current_blog;
			$name = stripcslashes($args[0]);
			return isset($npcink_blogs[$npcink_current_blog]['tables'][$name]) ? $name : null;
		}
		return null;
	}

	public function query($prepared)
	{
		$this->writes[] = $prepared;
		if (!is_array($prepared)) {
			return 1;
		}
		if (strpos($prepared[0], 'DROP TABLE') !== false) {
			global $npcink_blogs, $npcink_current_blog;
			unset($npcink_blogs[$npcink_current_blog]['tables'][$prepared[1][0]]);
		}
		if (strpos($prepared[0], 'DELETE FROM %i WHERE option_name') !== false) {
			global $npcink_blogs, $npcink_current_blog;
			foreach (array_slice($prepared[1], 1) as $pattern) {
				$prefix = stripcslashes(substr($pattern, 0, -1));
				foreach (array_keys($npcink_blogs[$npcink_current_blog]['options']) as $key) {
					if (strpos($key, $prefix) === 0) {
						unset($npcink_blogs[$npcink_current_blog]['options'][$key]);
					}
				}
			}
		}
		return 1;
	}
}

function npcink_multisite_assert($condition, $message)
{
	if (!$condition) {
		throw new RuntimeException($message);
	}
}

require_once __DIR__ . '/../includes/v3/class-npcink-device-inventory-v3-tables.php';
require_once __DIR__ . '/../admin/partials/npcink-device-inventory-admin-uninstall.php';

$wpdb = new Npcink_Multisite_Uninstall_Db();
$plugin_tables = array(
	Npcink_Device_Inventory_V3_Tables::ASSETS,
	Npcink_Device_Inventory_V3_Tables::IDENTITIES,
	Npcink_Device_Inventory_V3_Tables::OBSERVATIONS,
	Npcink_Device_Inventory_V3_Tables::EVENTS,
);

$npcink_blogs[1] = array(
	'prefix' => 'wp_',
	'options_table' => 'wp_options',
	'options' => array(
		Npcink_Device_Inventory_V3_Tables::OPTION => array(
			'delete_data_on_uninstall' => false,
			'asset_number_prefix' => 'A',
		),
		Npcink_Device_Inventory_V3_Tables::CLIENT_TOKENS_OPTION => array(
			array('id' => 'keep', 'secret' => 'keep-secret'),
		),
		'npcink_device_inventory_schema_revision' => 12,
		'npcink_v3_upload_nonce_keep' => '1',
	),
	'tables' => array(),
);
$npcink_blogs[2] = array(
	'prefix' => 'wp_2_',
	'options_table' => 'wp_2_options',
	'options' => array(
		Npcink_Device_Inventory_V3_Tables::OPTION => array(
			'delete_data_on_uninstall' => true,
			'asset_number_prefix' => 'B',
		),
		Npcink_Device_Inventory_V3_Tables::CLIENT_TOKENS_OPTION => array(
			array('id' => 'drop', 'secret' => 'drop-secret'),
		),
		'npcink_device_inventory_schema_revision' => 12,
		'npcink_v3_upload_nonce_drop' => '1',
	),
	'tables' => array(),
);
foreach ($plugin_tables as $suffix) {
	$npcink_blogs[1]['tables']['wp_' . $suffix] = true;
	$npcink_blogs[2]['tables']['wp_2_' . $suffix] = true;
}

try {
	switch_to_blog(1);
	Npcink_Device_Inventory_Admin_Uninstall::run();
	npcink_multisite_assert($npcink_current_blog === $npcink_origin_blog, 'Multisite uninstall must restore the original site.');
	npcink_multisite_assert(count($npcink_blogs[1]['tables']) === 4, 'A site that opted to keep data must retain its tables.');
	npcink_multisite_assert(isset($npcink_blogs[1]['options'][Npcink_Device_Inventory_V3_Tables::OPTION]), 'A site that opted to keep data must retain its settings.');
	npcink_multisite_assert($npcink_blogs[1]['options'][Npcink_Device_Inventory_V3_Tables::CLIENT_TOKENS_OPTION][0]['secret'] === 'keep-secret', 'A site that opted to keep data must retain its client tokens.');
	npcink_multisite_assert(isset($npcink_blogs[1]['options']['npcink_v3_upload_nonce_keep']), 'A site that opted to keep data must retain replay protections.');
	npcink_multisite_assert($npcink_blogs[1]['options']['npcink_device_inventory_schema_revision'] === 12, 'A site that opted to keep data must retain its schema revision.');
	npcink_multisite_assert($npcink_blogs[2]['tables'] === array(), 'A site that opted to delete data must drop its tables.');
	npcink_multisite_assert(!isset($npcink_blogs[2]['options'][Npcink_Device_Inventory_V3_Tables::OPTION]), 'A site that opted to delete data must clear its settings.');
	npcink_multisite_assert(!isset($npcink_blogs[2]['options'][Npcink_Device_Inventory_V3_Tables::CLIENT_TOKENS_OPTION]), 'A site that opted to delete data must clear its client tokens.');
	npcink_multisite_assert(!isset($npcink_blogs[2]['options']['npcink_device_inventory_schema_revision']), 'A site that opted to delete data must clear its schema revision.');
	npcink_multisite_assert(!isset($npcink_blogs[2]['options']['npcink_v3_upload_nonce_drop']), 'A site that opted to delete data must clear replay protections.');
	echo "Multisite uninstall fixture checks passed.\n";
} finally {
	rmdir($fixture_root);
}
