<?php

define('ABSPATH', __DIR__ . '/');
define('ARRAY_A', 'ARRAY_A');

class WP_REST_Response
{
	private $data;
	public function __construct($data)
	{
		$this->data = $data;
	}
	public function get_data()
	{
		return $this->data;
	}
}

class WP_Error
{
}

class WP_REST_Server
{
	const READABLE = 'GET';
	const CREATABLE = 'POST';
	const EDITABLE = 'POST, PUT, PATCH';
	const DELETABLE = 'DELETE';
}

function rest_ensure_response($value)
{
	return $value instanceof WP_REST_Response ? $value : new WP_REST_Response($value);
}

function sanitize_text_field($value)
{
	return trim((string) $value);
}

function sanitize_key($value)
{
	return strtolower(preg_replace('/[^a-zA-Z0-9_\-]/', '', (string) $value));
}

function sanitize_textarea_field($value)
{
	return trim((string) $value);
}

function is_wp_error($value)
{
	return $value instanceof WP_Error;
}

function current_user_can($capability)
{
	return true;
}

function current_time($type)
{
	return isset($GLOBALS['npcink_current_date']) ? $GLOBALS['npcink_current_date'] : '2026-11-25';
}

function wp_timezone()
{
	return isset($GLOBALS['npcink_timezone']) ? $GLOBALS['npcink_timezone'] : new DateTimeZone('Asia/Shanghai');
}

function get_option($name, $fallback = false)
{
	return array('departments' => array('未分配'));
}

function register_rest_route($namespace, $route, $args)
{
	return true;
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
		return array('departments' => array('未分配'));
	}

	public static function normalize_departments_with_default($departments)
	{
		return $departments;
	}
}

class Npcink_Device_Inventory_Asset_Repository
{
}

class Npcink_Device_Inventory_Identity_Repository
{
}

class Npcink_Device_Inventory_Event_Repository
{
}

class Npcink_Device_Inventory_Event_Service
{
}

require_once __DIR__ . '/../includes/v3/class-npcink-device-inventory-v3-response.php';
require_once __DIR__ . '/../includes/v3/rest/class-npcink-device-inventory-assets-controller.php';
require_once __DIR__ . '/../includes/v3/repositories/class-npcink-device-inventory-observation-repository.php';


class Npcink_Device_Inventory_Observation_Repository_Spy extends Npcink_Device_Inventory_Observation_Repository
{
	public $daily_count_args = array();
	public $daily_counts = array();

	public function daily_counts_between($start_at, $end_at, $day_ranges = array())
	{
		$this->daily_count_args = array($start_at, $end_at, $day_ranges);
		if ($this->daily_counts) {
			return $this->daily_counts;
		}
		$counts = array();
		$samples = array(
			'2026-11-24 16:30:00',
			'2026-10-26 16:30:00',
			'2026-10-26 15:59:59',
		);
		foreach ($day_ranges as $range) {
			$count = 0;
			foreach ($samples as $observed_at) {
				if ($observed_at >= $range['start_utc'] && $observed_at < $range['end_utc']) {
					$count++;
				}
			}
			if ($count > 0) {
				$counts[] = array('day' => $range['date'], 'count' => $count);
			}
		}
		return $counts;
	}
}

class Npcink_Trend_Request
{
	public function get_param($key)
	{
		return null;
	}
}

class Npcink_Trend_Wpdb
{
	public $queries = array();
	public $args = array();

	public function prepare($query, ...$args)
	{
		if (count($args) === 1 && is_array($args[0])) {
			$args = $args[0];
		}
		$this->queries[] = $query;
		$this->args[] = $args;
		return $query;
	}

	public function get_results($query, $format = null)
	{
		return array();
	}
}

function npcink_trend_assert($condition, $message)
{
	if (!$condition) {
		fwrite(STDERR, "Collection trend timezone fixture failed: {$message}\n");
		exit(1);
	}
}


$GLOBALS['npcink_current_date'] = '2026-11-25';
$GLOBALS['npcink_timezone'] = new DateTimeZone('Asia/Shanghai');
$observations = new Npcink_Device_Inventory_Observation_Repository_Spy();
$controller = new Npcink_Device_Inventory_Assets_Controller(
	new Npcink_Device_Inventory_Asset_Repository(),
	new Npcink_Device_Inventory_Identity_Repository(),
	$observations,
	new Npcink_Device_Inventory_Event_Repository(),
	new Npcink_Device_Inventory_Event_Service()
);

$data = $controller->get_collection_trends(new Npcink_Trend_Request())->get_data()['data'];
npcink_trend_assert($data['days'] === 30 && count($data['collection']) === 30, 'trends must fill a 30-day local window');
npcink_trend_assert($data['startDate'] === '2026-10-27' && $data['endDate'] === '2026-11-25', 'window must use Asia/Shanghai calendar dates');
npcink_trend_assert($observations->daily_count_args[0] === '2026-10-26 16:00:00', 'filter start must be local midnight converted to UTC');
npcink_trend_assert($observations->daily_count_args[1] === '2026-11-25 16:00:00', 'filter end must be the next local midnight converted to UTC');
npcink_trend_assert($observations->daily_count_args[2][0] === array('date' => '2026-10-27', 'start_utc' => '2026-10-26 16:00:00', 'end_utc' => '2026-10-27 16:00:00'), 'first bucket must be 2026-10-27 local time');
npcink_trend_assert($observations->daily_count_args[2][29] === array('date' => '2026-11-25', 'start_utc' => '2026-11-24 16:00:00', 'end_utc' => '2026-11-25 16:00:00'), 'last bucket must be 2026-11-25 local time');

$by_day = array();
foreach ($data['collection'] as $row) {
	$by_day[$row['date']] = $row['count'];
}
npcink_trend_assert($by_day['2026-11-25'] === 1, 'observed_at=2026-11-24 16:30:00 must count as 2026-11-25');
npcink_trend_assert($by_day['2026-10-27'] === 1, 'observed_at=2026-10-26 16:30:00 must appear on 2026-10-27');
npcink_trend_assert($by_day['2026-11-24'] === 0, 'the UTC date 2026-11-24 must not keep the early-morning observation');
npcink_trend_assert(!isset($by_day['2026-10-26']), 'an observation at 2026-10-26 15:59:59 UTC must stay outside the 30-day window');

$wpdb = new Npcink_Trend_Wpdb();
$repository = new Npcink_Device_Inventory_Observation_Repository();
$day_ranges = $observations->daily_count_args[2];
$repository->daily_counts_between('2026-10-26 16:00:00', '2026-11-25 16:00:00', $day_ranges);
npcink_trend_assert(count($wpdb->queries) === 1, 'ranged trend aggregate must run one query');
npcink_trend_assert(strpos($wpdb->queries[0], 'DATE(o.observed_at)') === false, 'ranged trend aggregate must not bucket by UTC DATE()');
npcink_trend_assert(strpos($wpdb->queries[0], 'CASE ') !== false, 'ranged trend aggregate must group by local-day UTC ranges');
npcink_trend_assert(strpos($wpdb->queries[0], "a.status <> 'deleted'") !== false, 'ranged trend aggregate must exclude archived assets');
npcink_trend_assert($wpdb->args[0][0] === '2026-10-26 16:00:00' && $wpdb->args[0][2] === '2026-10-27', 'SQL must bind the first local-day UTC range');
$last_range_offset = (30 * 3) - 3;
npcink_trend_assert($wpdb->args[0][$last_range_offset] === '2026-11-24 16:00:00' && $wpdb->args[0][$last_range_offset + 2] === '2026-11-25', 'SQL must bind the last local-day UTC range');

$santiago = new DateTimeZone('America/Santiago');
$controller->collection_trends_for_date('2026-09-10', $santiago);
$ranges = array_column($observations->daily_count_args[2], null, 'date');
npcink_trend_assert($ranges['2026-09-06']['start_utc'] === '2026-09-06 04:00:00', 'A skipped midnight must start at the first valid local time.');
npcink_trend_assert($ranges['2026-09-06']['end_utc'] === $ranges['2026-09-07']['start_utc'] && $ranges['2026-09-07']['start_utc'] === '2026-09-07 03:00:00', 'The next day must not inherit the normalized 01:00 clock time.');
$controller->collection_trends_for_date('2026-09-06', $santiago);
npcink_trend_assert($observations->daily_count_args[1] === '2026-09-07 03:00:00', 'The filter end must also be exact when today has a skipped midnight.');

$controller->collection_trends_for_date('2026-11-02', new DateTimeZone('America/Havana'));
$ranges = array_column($observations->daily_count_args[2], null, 'date');
npcink_trend_assert($ranges['2026-11-01']['start_utc'] === '2026-11-01 04:00:00' && $ranges['2026-11-01']['end_utc'] === '2026-11-02 05:00:00', 'Both occurrences of midnight must belong to the same 25-hour day.');

echo "Collection trend timezone fixture checks passed.\n";
