<?php

define('ABSPATH', __DIR__ . '/');
define('ARRAY_A', 'ARRAY_A');
function sanitize_key($value) { return $value; }
function sanitize_text_field($value) { return $value; }
$npcink_observation_cache = array();
function wp_cache_get($key, $group) { return $GLOBALS['npcink_observation_cache'][$group . ':' . $key] ?? false; }
function wp_cache_set($key, $value, $group, $ttl = 0) { $GLOBALS['npcink_observation_cache'][$group . ':' . $key] = $value; return true; }
function wp_json_encode($value) { return json_encode($value); }
class Npcink_Device_Inventory_V3_Sanitizer
{
	public static function json_encode($value) { return json_encode($value); }
}
class Npcink_Device_Inventory_V3_Tables
{
	public static function observations() { return 'observations'; }
	public static function assets() { return 'assets'; }
}
class Npcink_Observation_Write_Db
{
	public $insert_id = 501;
	public $update_result = false;
	public $row = array('id' => 501, 'asset_id' => 42);
	public function insert($table, $row, $formats) { return 1; }
	public function prepare($query, ...$args) { return $query; }
	public function get_var($query) { return 2; }
	public function query($query) { return $this->update_result; }
	public function get_row($query, $output) { return $this->row; }
}
require_once __DIR__ . '/../includes/v3/repositories/class-npcink-device-inventory-observation-repository.php';
$wpdb = new Npcink_Observation_Write_Db();
$repository = new Npcink_Device_Inventory_Observation_Repository();
$input = array('source' => 'fixture', 'schema_version' => 5, 'observed_at' => '2026-10-26 12:00:00', 'summary' => array(), 'hardware' => array(), 'raw' => array());
if ($repository->create(42, $input) !== null) {
	throw new RuntimeException('A failed latest-pointer update must fail the observation write.');
}
$wpdb->update_result = 0;
if (!$repository->create(42, $input)) {
	throw new RuntimeException('An older observation must still be retained when the latest pointer does not change.');
}
$wpdb->update_result = 1;
if ($repository->create(42, $input)['id'] !== 501) {
	throw new RuntimeException('A successful latest-pointer update must preserve the inserted observation ID.');
}
$wpdb->row = null;
$repository->invalidate_cache();
if ($repository->find_by_id(501) !== null) {
	throw new RuntimeException('Rollback invalidation must discard a cached observation read by ID.');
}
echo "Observation repository fixture checks passed.\n";
