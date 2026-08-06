<?php

define('ABSPATH', __DIR__ . '/');
define('ARRAY_A', 'ARRAY_A');

class Npcink_Asset_Search_Wpdb
{
	public $queries = array();
	public $args = array();

	public function esc_like($value)
	{
		return addcslashes((string) $value, '_%\\');
	}

	public function prepare($query, ...$args)
	{
		$this->queries[] = $query;
		$this->args[] = $args;
		return $query;
	}

	public function get_var($query)
	{
		return 0;
	}

	public function get_results($query, $format = null)
	{
		return array();
	}
}

class Npcink_Device_Inventory_V3_Tables
{
	public static function assets()
	{
		return 'wp_npcink_assets';
	}

	public static function identities()
	{
		return 'wp_npcink_identities';
	}

	public static function observations()
	{
		return 'wp_npcink_observations';
	}
}

function npcink_asset_search_assert($condition, $message)
{
	if (!$condition) {
		fwrite(STDERR, "Asset search fixture failed: {$message}\n");
		exit(1);
	}
}

function sanitize_text_field($value)
{
	return trim((string) $value);
}

function sanitize_key($value)
{
	return strtolower(preg_replace('/[^a-zA-Z0-9_\-]/', '', (string) $value));
}

function wp_cache_get($key, $group = '')
{
	return false;
}

function wp_cache_set($key, $value, $group = '', $expiration = 0)
{
	return true;
}

function wp_json_encode($value)
{
	return json_encode($value);
}

require_once __DIR__ . '/../includes/v3/repositories/class-npcink-device-inventory-asset-repository.php';

$wpdb = new Npcink_Asset_Search_Wpdb();
$repository = new Npcink_Device_Inventory_Asset_Repository();
$method = new ReflectionMethod($repository, 'should_search_extended_asset_data');
$method->setAccessible(true);

npcink_asset_search_assert($method->invoke($repository, '') === false, 'empty search should not trigger extended search');
npcink_asset_search_assert($method->invoke($repository, 'it') === false, 'short keyword should not trigger extended search');
npcink_asset_search_assert($method->invoke($repository, 'printer') === false, 'normal text keyword should not trigger extended search');
npcink_asset_search_assert($method->invoke($repository, '192.168.') === true, 'IP prefix should trigger extended search');
npcink_asset_search_assert($method->invoke($repository, 'AA:BB:CC') === true, 'MAC-like token should trigger extended search');
npcink_asset_search_assert($method->invoke($repository, 'SN123456') === true, 'long serial-like token should trigger extended search');

$repository->list_assets(
	array(
		'page' => 1,
		'pageSize' => 10,
		'search' => 'it',
		'asset_type' => '',
		'status' => '',
		'department' => '',
		'category' => '',
		'asset_scope' => '',
		'purchase_platform' => '',
		'financial_data_status' => 'missing_both',
		'sort_by' => '',
		'include_deleted' => false,
	)
);

npcink_asset_search_assert(count($wpdb->queries) === 2, 'list_assets should run count and select queries');
$select_query = $wpdb->queries[1];
$select_args = $wpdb->args[1];
$count_query = $wpdb->queries[0];
$count_args = $wpdb->args[0];

preg_match_all('/%(?:i|s|d|f)/', $count_query, $count_placeholders);
preg_match_all('/%(?:i|s|d|f)/', $select_query, $select_placeholders);
npcink_asset_search_assert(count($count_placeholders[0]) === count($count_args), 'count query placeholders must match prepared arguments');
npcink_asset_search_assert(count($select_placeholders[0]) === count($select_args), 'select query placeholders must match prepared arguments');

npcink_asset_search_assert(strpos($select_query, "OR (%s = '1' AND a.metadata_json LIKE %s)") !== false, 'asset metadata LIKE must be guarded');
npcink_asset_search_assert(strpos($select_query, "OR (%s = '1' AND EXISTS") !== false, 'extended EXISTS search must be guarded');
npcink_asset_search_assert(strpos($select_query, "WHEN %s = '1' AND lo.summary_json LIKE %s THEN 5") !== false, 'summary ranking must be guarded');
npcink_asset_search_assert(in_array('__npcink_no_extended_asset_match__', $select_args, true), 'short keyword should use extended search sentinel');
npcink_asset_search_assert(in_array('', $select_args, true), 'short keyword should pass disabled extended search flag');
npcink_asset_search_assert(strpos($select_query, "missing_purchase_price' AND a.purchase_price <= 0") !== false, 'purchase price completeness guard must exist');
npcink_asset_search_assert(strpos($select_query, "missing_second_hand_market_value' AND a.residual_value <= 0") !== false, 'second-hand market value completeness guard must exist');
npcink_asset_search_assert(in_array('missing_both', $select_args, true), 'financial data status must be passed into the prepared query');

echo "Asset search fixture checks passed.\n";
