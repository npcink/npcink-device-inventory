<?php

define('ABSPATH', __DIR__ . '/');

class WP_Error
{
	private $code;
	private $data;

	public function __construct($code, $message = '', $data = array())
	{
		$this->code = $code;
		$this->data = $data;
	}

	public function get_error_code()
	{
		return $this->code;
	}

	public function get_error_data()
	{
		return $this->data;
	}
}

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

class Npcink_Asset_Write_Request implements ArrayAccess
{
	private $params;

	public function __construct($params)
	{
		$this->params = $params;
	}

	public function get_json_params()
	{
		return $this->params;
	}

	public function get_param($key)
	{
		return isset($this->params[$key]) ? $this->params[$key] : null;
	}

	public function offsetExists($offset): bool
	{
		return isset($this->params[$offset]);
	}

	public function offsetGet($offset): mixed
	{
		return isset($this->params[$offset]) ? $this->params[$offset] : null;
	}

	public function offsetSet($offset, $value): void
	{
		$this->params[$offset] = $value;
	}

	public function offsetUnset($offset): void
	{
		unset($this->params[$offset]);
	}
}

class Npcink_Asset_Write_Wpdb
{
	public $commands = array();
	public $fail_command = '';

	public function query($query)
	{
		$this->commands[] = $query;
		if ($query === $this->fail_command) {
			return false;
		}
		return true;
	}

	public function prepare($query, ...$args)
	{
		return $query;
	}

	public function get_col($query)
	{
		return array();
	}
}

class Npcink_Device_Inventory_V3_Tables
{
	const OPTION = 'npcink_device_inventory_v3_options';

	public static function assets()
	{
		return 'wp_npcink_assets';
	}

	public static function normalize_departments_with_default($departments)
	{
		return array_values(array_unique(array_merge(array('未分配'), self::normalize_departments($departments))));
	}

	public static function normalize_departments($departments)
	{
		return array_values(array_filter(array_map('trim', is_array($departments) ? $departments : array())));
	}
}

class Npcink_Device_Inventory_Asset_Repository
{
	public $assets;
	public $fail_updates = array();
	public $updates = array();
	public $cache_invalidations = 0;
	public $duplicate_write_failure = false;

	public function __construct($assets = array())
	{
		$this->assets = $assets;
	}

	public function find_by_uuid($uuid)
	{
		return isset($this->assets[$uuid]) ? $this->assets[$uuid] : null;
	}

	public function find_by_asset_number($asset_number)
	{
		foreach ($this->assets as $asset) {
			if ((string) $asset['asset_number'] === (string) $asset_number) {
				return $asset;
			}
		}
		return null;
	}

	public function update($uuid, $changes)
	{
		$this->updates[] = array($uuid, $changes);
		if ($this->duplicate_write_failure || in_array($uuid, $this->fail_updates, true) || !isset($this->assets[$uuid])) {
			return null;
		}
		$this->assets[$uuid] = array_merge($this->assets[$uuid], $changes);
		return $this->assets[$uuid];
	}

	public function last_write_was_duplicate_asset_number()
	{
		return $this->duplicate_write_failure;
	}

	public function invalidate_cache()
	{
		$this->cache_invalidations++;
	}
}

class Npcink_Device_Inventory_Identity_Repository
{
	const CLAIM_CONFLICT = 'conflict';
}

class Npcink_Device_Inventory_Observation_Repository
{
	public $daily_counts = array();
	public $daily_count_args = array();
	public $cache_invalidations = 0;

	public function daily_counts_between($start_at, $end_at)
	{
		$this->daily_count_args = array($start_at, $end_at);
		return $this->daily_counts;
	}

	public function invalidate_cache()
	{
		$this->cache_invalidations++;
	}
}

class Npcink_Device_Inventory_Event_Repository
{
}

class Npcink_Device_Inventory_Event_Service
{
	public $records = array();
	public $fail = false;

	public function record($asset_id, $source, $type, $message, $payload = array())
	{
		$this->records[] = compact('asset_id', 'source', 'type', 'message', 'payload');
		return !$this->fail;
	}
}

function sanitize_text_field($value)
{
	return trim((string) $value);
}

function sanitize_textarea_field($value)
{
	return trim((string) $value);
}

function sanitize_key($value)
{
	return strtolower(preg_replace('/[^a-zA-Z0-9_\-]/', '', (string) $value));
}

function is_wp_error($value)
{
	return $value instanceof WP_Error;
}

function rest_ensure_response($value)
{
	return $value instanceof WP_REST_Response ? $value : new WP_REST_Response($value);
}

function current_user_can($capability)
{
	return true;
}

function current_time($type)
{
	return '2026-07-15';
}

function get_option($name, $fallback = false)
{
	return array('departments' => array('未分配', 'IT', '财务'));
}

function register_rest_route($namespace, $route, $args)
{
	return true;
}

require_once __DIR__ . '/../includes/v3/class-npcink-device-inventory-v3-response.php';
require_once __DIR__ . '/../includes/v3/rest/class-npcink-device-inventory-assets-controller.php';

function npcink_asset_write_assert($condition, $message)
{
	if (!$condition) {
		fwrite(STDERR, "Asset write fixture failed: {$message}\n");
		exit(1);
	}
}

function npcink_asset_row($id, $uuid, $status = 'active')
{
	return array(
		'id' => $id,
		'uuid' => $uuid,
		'asset_type' => 'computer',
		'asset_number' => 'ASSET-' . $id,
		'name' => 'Device ' . $id,
		'owner_name' => '',
		'department' => 'IT',
		'status' => $status,
		'category' => 'computer',
		'purchase_price' => '0',
		'residual_value' => '0',
		'financial_residual_value' => '0',
		'metadata_json' => '{}',
		'created_at' => '2026-07-15 00:00:00',
		'updated_at' => '2026-07-15 00:00:00',
	);
}

function npcink_asset_write_controller($rows)
{
	$assets = new Npcink_Device_Inventory_Asset_Repository($rows);
	$events = new Npcink_Device_Inventory_Event_Service();
	$observations = new Npcink_Device_Inventory_Observation_Repository();
	$controller = new Npcink_Device_Inventory_Assets_Controller(
		$assets,
		new Npcink_Device_Inventory_Identity_Repository(),
		$observations,
		new Npcink_Device_Inventory_Event_Repository(),
		$events
	);
	return array($controller, $assets, $events, $observations);
}

$wpdb = new Npcink_Asset_Write_Wpdb();
list($controller) = npcink_asset_write_controller(array());
$trend_observations = new Npcink_Device_Inventory_Observation_Repository();
$trend_observations->daily_counts = array(
	array('day' => '2026-07-14', 'count' => '2'),
	array('day' => '2026-07-15', 'count' => '3'),
);
$trend_controller = new Npcink_Device_Inventory_Assets_Controller(
	new Npcink_Device_Inventory_Asset_Repository(),
	new Npcink_Device_Inventory_Identity_Repository(),
	$trend_observations,
	new Npcink_Device_Inventory_Event_Repository(),
	new Npcink_Device_Inventory_Event_Service()
);
$trend_response = $trend_controller->get_collection_trends(new Npcink_Asset_Write_Request(array()));
$trend_data = $trend_response->get_data()['data'];
npcink_asset_write_assert($trend_data['days'] === 30, 'collection trends must return a fixed 30-day window');
npcink_asset_write_assert(count($trend_data['collection']) === 30, 'collection trends must fill every day in the window');
npcink_asset_write_assert($trend_data['startDate'] === '2026-06-16' && $trend_data['endDate'] === '2026-07-15', 'collection trends must use the WordPress current date');
npcink_asset_write_assert($trend_data['collection'][28]['count'] === 2 && $trend_data['collection'][29]['count'] === 3, 'collection trends must merge aggregate counts into the filled window');
npcink_asset_write_assert($trend_observations->daily_count_args === array('2026-06-16 00:00:00', '2026-07-16 00:00:00'), 'collection trend query must use a bounded half-open range');
$invalid = $controller->create_item(new Npcink_Asset_Write_Request(array('status' => 'unknown')));
npcink_asset_write_assert(is_wp_error($invalid) && $invalid->get_error_code() === 'invalid_asset_status', 'invalid status must fail validation');
npcink_asset_write_assert($wpdb->commands === array(), 'validation failure must not start a transaction');
$invalid_financial_filter = $controller->get_items(new Npcink_Asset_Write_Request(array('financialDataStatus' => 'unknown')));
npcink_asset_write_assert(is_wp_error($invalid_financial_filter) && $invalid_financial_filter->get_error_code() === 'invalid_financial_data_status', 'invalid financial data status must fail at the REST boundary');
$legacy_type = $controller->create_item(new Npcink_Asset_Write_Request(array('assetType' => 'pc')));
npcink_asset_write_assert(is_wp_error($legacy_type) && $legacy_type->get_error_code() === 'invalid_asset_type', 'legacy asset types must fail validation');
npcink_asset_write_assert($wpdb->commands === array(), 'legacy asset type failure must not start a transaction');

$first_uuid = '11111111-1111-4111-8111-111111111111';
$second_uuid = '22222222-2222-4222-8222-222222222222';
$rows = array($first_uuid => npcink_asset_row(1, $first_uuid), $second_uuid => npcink_asset_row(2, $second_uuid));
list($controller, $assets, $events) = npcink_asset_write_controller($rows);

$financial_values = $controller->update_item(
	new Npcink_Asset_Write_Request(
		array(
			'uuid' => $first_uuid,
			'secondHandMarketValue' => 800,
			'financialResidualValue' => 300,
		)
	)
);
npcink_asset_write_assert($financial_values instanceof WP_REST_Response, 'distinct financial values must be accepted');
$financial_data = $financial_values->get_data()['data'];
npcink_asset_write_assert($financial_data['secondHandMarketValue'] === 800.0, 'second-hand market value must round-trip independently');
npcink_asset_write_assert($financial_data['financialResidualValue'] === 300.0, 'financial residual value must round-trip independently');
npcink_asset_write_assert($financial_data['residualValue'] === 800.0, 'legacy residualValue response alias must remain compatible');
$wpdb->commands = array();

$retirement_row = npcink_asset_row(1, $first_uuid);
$retirement_row['purchase_price'] = '5000';
$retirement_row['residual_value'] = '800';
$retirement_row['financial_residual_value'] = '300';
list($retirement_controller, $retirement_assets) = npcink_asset_write_controller(array($first_uuid => $retirement_row));
$retired = $retirement_controller->update_item(
	new Npcink_Asset_Write_Request(array('uuid' => $first_uuid, 'status' => 'retired'))
);
npcink_asset_write_assert($retired instanceof WP_REST_Response, 'retiring an asset must succeed');
$retirement_changes = $retirement_assets->updates[0][1];
npcink_asset_write_assert($retirement_changes['status'] === 'retired', 'retirement must persist the retired status');
npcink_asset_write_assert($retirement_changes['residual_value'] === 0.0, 'retirement must zero second-hand market value');
npcink_asset_write_assert($retirement_changes['financial_residual_value'] === 0.0, 'retirement must zero carrying value');
npcink_asset_write_assert(!array_key_exists('purchase_price', $retirement_changes), 'retirement must preserve purchase price');

$wpdb = new Npcink_Asset_Write_Wpdb();
$already_retired_row = npcink_asset_row(1, $first_uuid, 'retired');
list($retirement_controller, $retirement_assets) = npcink_asset_write_controller(array($first_uuid => $already_retired_row));
$retired_revalue = $retirement_controller->update_item(
	new Npcink_Asset_Write_Request(
		array(
			'uuid' => $first_uuid,
			'purchasePrice' => 6000,
			'secondHandMarketValue' => 900,
			'financialResidualValue' => 400,
		)
	)
);
npcink_asset_write_assert($retired_revalue instanceof WP_REST_Response, 'editing a retired asset must succeed');
$retired_revalue_changes = $retirement_assets->updates[0][1];
npcink_asset_write_assert($retired_revalue_changes['purchase_price'] === 6000.0, 'retired assets may update historical purchase price');
npcink_asset_write_assert($retired_revalue_changes['residual_value'] === 0.0, 'retired assets must reject a non-zero market value');
npcink_asset_write_assert($retired_revalue_changes['financial_residual_value'] === 0.0, 'retired assets must reject a non-zero carrying value');
$wpdb->commands = array();

$archived_rows = $rows;
$archived_rows[$second_uuid]['status'] = 'deleted';
list($duplicate_controller, $duplicate_assets, $duplicate_events) = npcink_asset_write_controller($archived_rows);
$duplicate_create = $duplicate_controller->create_item(
	new Npcink_Asset_Write_Request(array('assetNumber' => 'ASSET-2'))
);
npcink_asset_write_assert(is_wp_error($duplicate_create) && $duplicate_create->get_error_code() === 'duplicate_number', 'create must reject a number owned by an archived asset');
npcink_asset_write_assert($duplicate_create->get_error_data()['status'] === 409, 'duplicate create must return HTTP 409');
npcink_asset_write_assert($wpdb->commands === array(), 'duplicate create must fail before starting a transaction');

$duplicate_update = $duplicate_controller->update_item(
	new Npcink_Asset_Write_Request(array('uuid' => $first_uuid, 'assetNumber' => 'ASSET-2'))
);
npcink_asset_write_assert(is_wp_error($duplicate_update) && $duplicate_update->get_error_code() === 'duplicate_number', 'update must reject a number owned by an archived asset');
npcink_asset_write_assert($duplicate_update->get_error_data()['status'] === 409, 'duplicate update must return HTTP 409');
npcink_asset_write_assert($duplicate_assets->updates === array(), 'duplicate update must not write the asset');
npcink_asset_write_assert($duplicate_events->records === array(), 'duplicate update must not create an event');
npcink_asset_write_assert($wpdb->commands === array(), 'duplicate update must fail before starting a transaction');

$same_number_update = $duplicate_controller->update_item(
	new Npcink_Asset_Write_Request(array('uuid' => $first_uuid, 'assetNumber' => 'ASSET-1'))
);
npcink_asset_write_assert($same_number_update instanceof WP_REST_Response, 'an asset may retain its own number');
npcink_asset_write_assert($wpdb->commands === array('START TRANSACTION', 'COMMIT'), 'same-number update must commit normally');

$wpdb = new Npcink_Asset_Write_Wpdb();
list($race_controller, $race_assets, $race_events) = npcink_asset_write_controller($rows);
$race_assets->duplicate_write_failure = true;
$race_conflict = $race_controller->update_item(
	new Npcink_Asset_Write_Request(array('uuid' => $first_uuid, 'assetNumber' => 'RACE-NUMBER'))
);
npcink_asset_write_assert(is_wp_error($race_conflict) && $race_conflict->get_error_code() === 'duplicate_number', 'database duplicate-key fallback must return duplicate_number');
npcink_asset_write_assert($race_conflict->get_error_data()['status'] === 409, 'database duplicate-key fallback must return HTTP 409');
npcink_asset_write_assert($wpdb->commands === array('START TRANSACTION', 'ROLLBACK'), 'database duplicate-key fallback must roll back');
npcink_asset_write_assert($race_events->records === array(), 'database duplicate-key fallback must not create an event');

$wpdb = new Npcink_Asset_Write_Wpdb();
list($controller, $assets, $events) = npcink_asset_write_controller($rows);
$legacy_identity = $controller->create_identity(
	new Npcink_Asset_Write_Request(
		array(
			'uuid' => $first_uuid,
			'type' => 'stable_device_id_v3',
			'value' => 'legacy-identity',
		)
	)
);
npcink_asset_write_assert(is_wp_error($legacy_identity) && $legacy_identity->get_error_code() === 'invalid_identity', 'manual identity writes must use the current v2 contract');
$obsolete_issue_event = $controller->create_event(
	new Npcink_Asset_Write_Request(
		array(
			'uuid' => $first_uuid,
			'eventType' => 'issue_handled',
			'message' => 'obsolete state write',
		)
	)
);
npcink_asset_write_assert(is_wp_error($obsolete_issue_event) && $obsolete_issue_event->get_error_code() === 'invalid_event_type', 'removed analysis state events must not be persisted through the generic event route');
npcink_asset_write_assert($wpdb->commands === array(), 'obsolete event rejection must not start a transaction');
$response = $controller->batch_items(
	new Npcink_Asset_Write_Request(
		array(
			'operation' => 'update',
			'uuids' => array($first_uuid, $second_uuid, $first_uuid),
			'changes' => array('department' => '财务'),
			'context' => array('source' => 'analysis', 'message' => 'Apply reviewed department.'),
		)
	)
);
npcink_asset_write_assert($response instanceof WP_REST_Response, 'valid batch must return REST response');
$data = $response->get_data();
npcink_asset_write_assert($data['data']['updated'] === 2, 'duplicate UUIDs must be de-duplicated');
npcink_asset_write_assert($wpdb->commands === array('START TRANSACTION', 'COMMIT'), 'successful batch must commit exactly once');
npcink_asset_write_assert(count($events->records) === 2, 'successful batch must record one audit event per asset');
npcink_asset_write_assert($events->records[0]['payload']['batchSize'] === 2, 'event must use de-duplicated batch size');
npcink_asset_write_assert($events->records[0]['payload']['changedFields'][0]['oldValue'] === 'IT', 'event must preserve old value');
npcink_asset_write_assert($events->records[0]['payload']['changedFields'][0]['newValue'] === '财务', 'event must preserve new value');

$wpdb = new Npcink_Asset_Write_Wpdb();
$batch_retirement_rows = array($first_uuid => $retirement_row, $second_uuid => npcink_asset_row(2, $second_uuid));
list($batch_retirement_controller, $batch_retirement_assets, $batch_retirement_events) = npcink_asset_write_controller($batch_retirement_rows);
$batch_retired = $batch_retirement_controller->batch_items(
	new Npcink_Asset_Write_Request(
		array(
			'operation' => 'update',
			'uuids' => array($first_uuid, $second_uuid),
			'changes' => array('status' => 'retired'),
		)
	)
);
npcink_asset_write_assert($batch_retired instanceof WP_REST_Response, 'batch retirement must succeed');
foreach ($batch_retirement_assets->updates as $batch_update) {
	npcink_asset_write_assert($batch_update[1]['residual_value'] === 0.0, 'batch retirement must zero market value');
	npcink_asset_write_assert($batch_update[1]['financial_residual_value'] === 0.0, 'batch retirement must zero carrying value');
	npcink_asset_write_assert(!array_key_exists('purchase_price', $batch_update[1]), 'batch retirement must preserve purchase price');
}
npcink_asset_write_assert(count($batch_retirement_events->records[0]['payload']['changedFields']) === 3, 'batch audit must record status and the two values that actually changed');
npcink_asset_write_assert(count($batch_retirement_events->records[1]['payload']['changedFields']) === 1, 'batch audit must omit unchanged zero-value fields');

$wpdb = new Npcink_Asset_Write_Wpdb();
list($controller, $assets) = npcink_asset_write_controller(array($first_uuid => npcink_asset_row(1, $first_uuid)));
$missing = $controller->batch_items(
	new Npcink_Asset_Write_Request(
		array(
			'operation' => 'archive',
			'uuids' => array($first_uuid, $second_uuid),
		)
	)
);
npcink_asset_write_assert(is_wp_error($missing) && $missing->get_error_code() === 'asset_not_found', 'missing batch asset must fail');
npcink_asset_write_assert($wpdb->commands === array('START TRANSACTION', 'ROLLBACK'), 'partial batch must roll back');
npcink_asset_write_assert($assets->cache_invalidations === 1, 'partial batch rollback must invalidate transactional asset cache entries');

$wpdb = new Npcink_Asset_Write_Wpdb();
list($controller, $assets, $events) = npcink_asset_write_controller(array($first_uuid => npcink_asset_row(1, $first_uuid)));
$assets->fail_updates[] = $first_uuid;
$deleted = $controller->delete_item(new Npcink_Asset_Write_Request(array('uuid' => $first_uuid)));
npcink_asset_write_assert(is_wp_error($deleted) && $deleted->get_error_code() === 'asset_update_failed', 'failed archive write must return an error');
npcink_asset_write_assert($wpdb->commands === array('START TRANSACTION', 'ROLLBACK'), 'failed archive write must roll back');
npcink_asset_write_assert($events->records === array(), 'failed archive write must not create an audit event');
npcink_asset_write_assert($assets->cache_invalidations === 1, 'failed archive rollback must invalidate transactional asset cache entries');

$wpdb = new Npcink_Asset_Write_Wpdb();
list($controller, $assets, $events, $observations) = npcink_asset_write_controller(array($first_uuid => npcink_asset_row(1, $first_uuid)));
$archived = $controller->delete_item(new Npcink_Asset_Write_Request(array('uuid' => $first_uuid)));
npcink_asset_write_assert($archived instanceof WP_REST_Response, 'successful archive must return a REST response');
npcink_asset_write_assert($wpdb->commands === array('START TRANSACTION', 'COMMIT'), 'successful archive must commit exactly once');
npcink_asset_write_assert($observations->cache_invalidations === 1, 'successful archive must invalidate observation-derived caches');

$wpdb = new Npcink_Asset_Write_Wpdb();
list($controller, $assets, $events, $observations) = npcink_asset_write_controller(array($first_uuid => npcink_asset_row(1, $first_uuid)));
$batch_archived = $controller->batch_items(
	new Npcink_Asset_Write_Request(array('operation' => 'archive', 'uuids' => array($first_uuid)))
);
npcink_asset_write_assert($batch_archived instanceof WP_REST_Response, 'successful batch archive must return a REST response');
npcink_asset_write_assert($observations->cache_invalidations === 1, 'successful batch archive must invalidate observation-derived caches');

$wpdb = new Npcink_Asset_Write_Wpdb();
$wpdb->fail_command = 'COMMIT';
list($controller, $assets) = npcink_asset_write_controller(array($first_uuid => npcink_asset_row(1, $first_uuid)));
$commit_failed = $controller->batch_items(
	new Npcink_Asset_Write_Request(array('operation' => 'archive', 'uuids' => array($first_uuid)))
);
npcink_asset_write_assert(is_wp_error($commit_failed) && $commit_failed->get_error_code() === 'transaction_commit_failed', 'commit failure must return an error');
npcink_asset_write_assert($wpdb->commands === array('START TRANSACTION', 'COMMIT', 'ROLLBACK'), 'commit failure must close the transaction with rollback');
npcink_asset_write_assert($assets->cache_invalidations === 1, 'commit failure rollback must invalidate transactional asset cache entries');

echo "Asset write fixture checks passed.\n";
