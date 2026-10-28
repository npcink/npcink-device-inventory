<?php

define('ABSPATH', __DIR__ . '/');
define('ARRAY_A', 'ARRAY_A');

class WP_Error
{
	private $code;
	private $message;
	private $data;

	public function __construct($code, $message = '', $data = array())
	{
		$this->code = $code;
		$this->message = $message;
		$this->data = $data;
	}

	public function get_error_code()
	{
		return $this->code;
	}

	public function get_error_message()
	{
		return $this->message;
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

class WP_REST_Request
{
	private $body = '';
	private $params = array();
	private $headers = array();

	public function set_body($body)
	{
		$this->body = $body;
		$this->params = json_decode($body, true);
	}

	public function get_body()
	{
		return $this->body;
	}

	public function get_json_params()
	{
		return $this->params;
	}

	public function set_header($key, $value)
	{
		$this->headers[strtolower($key)] = $value;
	}

	public function get_header($key)
	{
		return isset($this->headers[strtolower($key)]) ? $this->headers[strtolower($key)] : '';
	}

	public function get_param($key)
	{
		return isset($this->params[$key]) ? $this->params[$key] : null;
	}

	public function set_param($key, $value)
	{
		$this->params[$key] = $value;
	}
}

class WP_REST_Server
{
	const CREATABLE = 'POST';
	const READABLE = 'GET';
}

class Npcink_Test_Wpdb
{
	public $prefix = 'wp_';
	public $insert_id = 1000;
	public $rows = array(
		'assets_by_uuid' => array(),
		'assets_by_number' => array(),
		'identities' => array(),
	);
	public $export_rows = array();
	public $count_overrides = array();
	public $commands = array();
	public $inserts = array();
	public $fail_command = '';
	public $last_error = '';
	public $fail_read = '';
	public $fail_read_in_transaction = false;
	private $in_transaction = false;
	private $last_query = '';
	private $last_args = array();

	public function prepare($query, ...$args)
	{
		$this->last_query = $query;
		$this->last_args = $args;
		return $query;
	}

	public function get_row($query, $format = null)
	{
		if ($this->read_failed($query)) {
			return null;
		}
		$key = isset($this->last_args[1]) ? (string) $this->last_args[1] : '';
		if (strpos($query, 'observation_uuid =') !== false) { return isset($this->rows['receipts'][$key]) ? $this->rows['receipts'][$key] : null; }
		if (strpos($query, 'uuid =') !== false && isset($this->rows['assets_by_uuid'][$key])) {
			return $this->rows['assets_by_uuid'][$key];
		}
		if (strpos($query, 'asset_number =') !== false && isset($this->rows['assets_by_number'][$key])) {
			return $this->rows['assets_by_number'][$key];
		}
		return null;
	}

	public function get_var($query)
	{
		if ($this->read_failed($query)) {
			return null;
		}
		if (strpos($query, 'COUNT(*)') !== false) {
			$table = isset($this->last_args[0]) ? (string) $this->last_args[0] : '';
			if (isset($this->count_overrides[$table])) {
				return $this->count_overrides[$table];
			}
			return isset($this->export_rows[$table]) ? count($this->export_rows[$table]) : 0;
		}
		if (strpos($query, 'identity_type') !== false) {
			$key = (isset($this->last_args[1]) ? $this->last_args[1] : '') . "\0" . (isset($this->last_args[2]) ? $this->last_args[2] : '');
			return isset($this->rows['identities'][$key]) ? $this->rows['identities'][$key] : null;
		}
		return null;
	}

	public function get_results($query, $format = null)
	{
		if ($this->read_failed($query)) {
			// wpdb returns an empty array for ARRAY_A even when the query failed.
			return array();
		}
		$table = isset($this->last_args[0]) ? (string) $this->last_args[0] : '';
		return isset($this->export_rows[$table]) ? $this->export_rows[$table] : array();
	}

	public function insert($table, $data, $formats = array())
	{
		$this->insert_id++;
		$this->inserts[] = array('table' => $table, 'data' => $data);
		return 1;
	}

	public function update($table, $data, $where, $formats = array(), $where_formats = array())
	{
		return 1;
	}

	public function query($query)
	{
		$this->commands[] = $query;
		$this->last_error = '';
		if ($query === 'START TRANSACTION') {
			$this->in_transaction = true;
		} elseif ($query === 'COMMIT' || $query === 'ROLLBACK') {
			$this->in_transaction = false;
		}
		if ($this->fail_command !== '' && $query === $this->fail_command) {
			return false;
		}
		return true;
	}

	private function read_failed($query)
	{
		$this->last_error = '';
		if ($this->fail_read !== '' && strpos($query, $this->fail_read) !== false && (!$this->fail_read_in_transaction || $this->in_transaction)) {
			$this->last_error = 'Injected database read failure';
			return true;
		}
		return false;
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

function sanitize_title($value)
{
	return sanitize_key(str_replace(' ', '-', (string) $value));
}

function wp_json_encode($value)
{
	return json_encode($value);
}

function current_time($type)
{
	return '2026-07-06 00:00:00';
}

function wp_generate_uuid4()
{
	static $index = 0;
	$index++;
	return sprintf('00000000-0000-4000-8000-%012d', $index);
}

function is_wp_error($value)
{
	return $value instanceof WP_Error;
}

function rest_ensure_response($value)
{
	return $value instanceof WP_REST_Response ? $value : new WP_REST_Response($value);
}

function get_option($name, $fallback = false)
{
	return $fallback;
}

function update_option($name, $value)
{
	global $npcink_updated_options;
	$npcink_updated_options[$name] = $value;
	return true;
}

function wp_cache_get($key, $group = '')
{
	return 0;
}

function wp_cache_set($key, $value, $group = '')
{
	return true;
}

function current_user_can($capability)
{
	return true;
}

function register_rest_route($namespace, $route, $args)
{
	return true;
}

require_once __DIR__ . '/../includes/v3/class-npcink-device-inventory-v3-tables.php';
require_once __DIR__ . '/../includes/v3/class-npcink-device-inventory-v3-response.php';
require_once __DIR__ . '/../includes/v3/class-npcink-device-inventory-v3-sanitizer.php';
require_once __DIR__ . '/../includes/v3/services/class-npcink-device-inventory-backup-export-service.php';
require_once __DIR__ . '/../includes/v3/rest/class-npcink-device-inventory-backup-restore-controller.php';

$wpdb = new Npcink_Test_Wpdb();
$npcink_updated_options = array();

function npcink_request($backup, $dry_run)
{
	$request = new WP_REST_Request();
	$body = wp_json_encode(array('backup' => $backup, 'dryRun' => $dry_run));
	$request->set_body($body);
	$request->set_header('content-length', strlen($body));
	return $request;
}

function npcink_restore($backup, $dry_run = true)
{
	$controller = new Npcink_Device_Inventory_Backup_Restore_Controller();
	return $controller->restore_backup(npcink_request($backup, $dry_run));
}

function npcink_export($sections)
{
	$request = new WP_REST_Request();
	$request->set_param('sections', implode(',', $sections));
	$controller = new Npcink_Device_Inventory_Backup_Restore_Controller();
	return $controller->export_backup($request);
}

function npcink_assert($condition, $message)
{
	if (!$condition) {
		fwrite(STDERR, "Backup restore fixture failed: {$message}\n");
		exit(1);
	}
}

function npcink_data($response)
{
	npcink_assert($response instanceof WP_REST_Response, 'expected REST response');
	return $response->get_data();
}

$wpdb->export_rows = array(
	'wp_npcink_assets' => array(
		array(
			'id' => 10,
			'uuid' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			'asset_type' => 'computer',
			'asset_number' => 'RESTORE-FIXTURE-001',
			'name' => 'Restore Fixture Asset',
			'owner_name' => 'Fixture Owner',
			'department' => '测试部',
			'status' => 'active',
			'category' => 'computer',
			'purchase_price' => '1000.00',
			'residual_value' => '100.00',
			'financial_residual_value' => '50.00',
			'metadata_json' => '{"fixture":true}',
			'created_at' => '2026-07-06 00:00:00',
			'updated_at' => '2026-07-06 00:00:00',
		),
	),
	'wp_npcink_asset_identities' => array(
		array(
			'id' => 20,
			'asset_id' => 10,
			'asset_uuid' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			'asset_number' => 'RESTORE-FIXTURE-001',
			'identity_type' => 'system_uuid_v2',
			'identity_value' => 'system-v2-backup-fixture',
			'confidence' => '100.00',
			'is_primary' => 1,
			'source' => 'fixture',
			'created_at' => '2026-07-06 00:00:00',
		),
	),
	'wp_npcink_asset_events' => array(
		array(
			'id' => 30,
			'asset_id' => 10,
			'asset_uuid' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			'asset_number' => 'RESTORE-FIXTURE-001',
			'event_source' => 'fixture',
			'event_type' => 'created',
			'field_name' => null,
			'old_value' => null,
			'new_value' => null,
			'message' => 'Fixture event',
			'actor_user_id' => null,
			'actor_name' => 'system',
			'payload_json' => '{}',
			'created_at' => '2026-07-06 00:00:00',
		),
	),
	'wp_npcink_asset_observations' => array(
		array(
			'id' => 40,
			'asset_id' => 10,
			'asset_uuid' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			'asset_number' => 'RESTORE-FIXTURE-001',
			'source' => 'fixture',
			'schema_version' => 3,
			'observed_at' => '2026-07-06 00:00:00',
			'received_at' => '2026-07-06 00:00:01',
			'summary_json' => '{}',
			'hardware_json' => '{}',
			'raw_json' => '{}',
		),
	),
);

$export_response = npcink_export(array('settings', 'assets', 'identities', 'events', 'observations'));
$export_result = npcink_data($export_response)['data'];
$exported_backup = $export_result['backup'];
npcink_assert(count($exported_backup['assets']) === 1, 'server export must include the asset snapshot');
npcink_assert($exported_backup['assets'][0]['secondHandMarketValue'] === 100.0, 'backup must export second-hand market value');
npcink_assert($exported_backup['assets'][0]['financialResidualValue'] === 50.0, 'backup must export financial residual value independently');
npcink_assert(count($exported_backup['identities'][0]['identities']) === 1, 'server export must group identities by asset');
npcink_assert($export_result['meta']['counts']['observations'] === 1, 'server export must report restorable section counts');
npcink_assert($exported_backup['settings']['renewalAgeYears'] === 5, 'server export must include the renewal age threshold');
npcink_assert($exported_backup['settings']['renewalMinMemoryGb'] === 8, 'server export must include the renewal memory threshold');
npcink_assert($exported_backup['settings']['renewalMinDiskGb'] === 256, 'server export must include the renewal disk threshold');
npcink_assert($exported_backup['settings']['renewalMaxResidualRate'] === 20.0, 'server export must include the renewal residual threshold');
npcink_assert($wpdb->commands === array('START TRANSACTION WITH CONSISTENT SNAPSHOT', 'COMMIT'), 'all export sections must share one snapshot');

$round_trip = npcink_restore($exported_backup, true);
$round_trip_summary = npcink_data($round_trip)['data']['summary'];
npcink_assert($round_trip_summary['available']['assets'] === 1, 'an exported backup must pass restore preview');
npcink_assert($round_trip_summary['available']['identities'] === 1, 'restore preview must count exported nested identities');

foreach (array('assets' => 'SELECT id, uuid', 'identities' => 'SELECT i.*', 'events' => 'SELECT e.*', 'observations' => 'SELECT o.*') as $section => $query) {
	$wpdb->commands = array();
	$wpdb->fail_read = $query;
	$failed_export = npcink_export(array($section));
	npcink_assert($failed_export instanceof WP_Error && $failed_export->get_error_code() === 'backup_export_failed', $section . ' read failure must not produce an empty successful backup');
	npcink_assert(end($wpdb->commands) === 'ROLLBACK' && !in_array('COMMIT', $wpdb->commands, true), 'failed export must roll back its snapshot');
}
$wpdb->fail_read = '';
$saved_export_rows = $wpdb->export_rows;
$wpdb->export_rows = array();
$empty_export = npcink_data(npcink_export(array('assets')))['data'];
npcink_assert($empty_export['backup']['assets'] === array(), 'a successful empty query must remain a valid backup');
$wpdb->export_rows = $saved_export_rows;

$settings_backup = array(
	'schema' => 'npcink-device-inventory/v3-admin-export',
	'exportedAt' => '2026-07-06T00:00:00+00:00',
	'settings' => array(
		'renewalAgeYears' => 7,
		'renewalMinMemoryGb' => 16,
		'renewalMinDiskGb' => 512,
		'renewalMaxResidualRate' => 15,
	),
);
$npcink_updated_options = array();
$settings_restore = npcink_restore($settings_backup, false);
npcink_assert($settings_restore instanceof WP_REST_Response, 'renewal settings restore should succeed');
$restored_options = $npcink_updated_options[Npcink_Device_Inventory_V3_Tables::OPTION];
npcink_assert($restored_options['renewal_age_years'] === 7, 'restore must apply the renewal age threshold');
npcink_assert($restored_options['renewal_min_memory_gb'] === 16, 'restore must apply the renewal memory threshold');
npcink_assert($restored_options['renewal_min_disk_gb'] === 512, 'restore must apply the renewal disk threshold');
npcink_assert($restored_options['renewal_max_residual_rate'] === 15.0, 'restore must apply the renewal residual threshold');

$wpdb->commands = array();
$wpdb->fail_command = 'COMMIT';
$commit_failed_export = npcink_export(array('assets'));
npcink_assert($commit_failed_export instanceof WP_Error, 'export must report snapshot commit failures');
npcink_assert($commit_failed_export->get_error_code() === 'backup_snapshot_failed', 'snapshot commit failures must use backup_snapshot_failed');
npcink_assert($wpdb->commands === array('START TRANSACTION WITH CONSISTENT SNAPSHOT', 'COMMIT', 'ROLLBACK'), 'failed snapshot commits must attempt a rollback');
$wpdb->fail_command = '';
$wpdb->commands = array();
$wpdb->count_overrides['wp_npcink_asset_events'] = 10001;
$oversized_export = npcink_export(array('events'));
npcink_assert($oversized_export instanceof WP_Error, 'export must reject a section that restore would reject');
npcink_assert($oversized_export->get_error_code() === 'backup_section_too_large', 'oversized export must use backup_section_too_large');
npcink_assert($wpdb->commands === array('START TRANSACTION WITH CONSISTENT SNAPSHOT', 'ROLLBACK'), 'oversized exports must close the snapshot without reading rows');
unset($wpdb->count_overrides['wp_npcink_asset_events']);

$base_backup = array(
	'schema' => 'npcink-device-inventory/v3-admin-export',
	'exportedAt' => '2026-07-06T00:00:00+00:00',
	'assets' => array(
		array(
			'id' => 10,
			'uuid' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			'assetNumber' => 'RESTORE-FIXTURE-001',
			'name' => 'Restore Fixture Asset',
		),
	),
);

// 3.2.3 exports carried the canonical market field plus a redundant old alias.
$release_backup = $exported_backup;
$release_backup['assets'][0]['residualValue'] = 999;
$release_backup['identities'][0]['identities'][] = array('identityType' => 'device_uuid_v1', 'identityValue' => 'device-v1-obsolete');
$release_backup['identities'][0]['identities'][] = array('identityType' => 'fallback_device_v1', 'identityValue' => 'fallback-v1-obsolete');
$wpdb->commands = array();
$release_preview = npcink_data(npcink_restore($release_backup, true))['data']['summary'];
npcink_assert($release_preview['planned']['assetsCreated'] === 1 && $release_preview['planned']['identitiesCreated'] === 1, '3.2.3 exports must preview current assets and identities');
npcink_assert($release_preview['skipped']['identities'] === 2 && count(array_filter($release_preview['warnings'], function ($warning) { return strpos($warning, 'v1') !== false; })) === 1, 'obsolete v1 identity rows must be explicitly counted and explained');
npcink_assert($wpdb->commands === array(), '3.2.3 preview must not start a write transaction');
$wpdb->inserts = array();
$release_import = npcink_data(npcink_restore($release_backup, false))['data']['summary'];
$restored_assets = array_values(array_filter($wpdb->inserts, function ($item) { return $item['table'] === 'wp_npcink_assets'; }));
$restored_identities = array_values(array_filter($wpdb->inserts, function ($item) { return $item['table'] === 'wp_npcink_asset_identities'; }));
npcink_assert($restored_assets[0]['data']['residual_value'] === 100.0, 'canonical market value must win over the redundant alias');
npcink_assert($restored_assets[0]['data']['financial_residual_value'] === 50.0, 'financial value must remain independent');
npcink_assert(count($restored_identities) === 1 && $restored_identities[0]['data']['identity_type'] === 'system_uuid_v2', 'restore must never insert obsolete v1 identities');
npcink_assert($release_import['skipped']['identities'] === 2, 'actual import must report the same obsolete identity count as preview');
npcink_assert(!array_key_exists('residualValue', $exported_backup['assets'][0]), 'current exports must omit the obsolete alias');

$invalid_type_backup = $base_backup;
$invalid_type_backup['assets'][0]['assetType'] = 'network';
$response = npcink_restore($invalid_type_backup, false);
npcink_assert($response instanceof WP_Error && $response->get_error_code() === 'invalid_backup_asset_type', 'historical asset types must not be silently converted');
$invalid_field_backup = $base_backup;
$invalid_field_backup['assets'][0]['residualValue'] = 10;
$response = npcink_restore($invalid_field_backup, false);
npcink_assert($response instanceof WP_Error && $response->get_error_code() === 'invalid_backup_field', 'historical financial fields must not be silently accepted');

$wpdb->commands = array();
$wpdb->fail_command = 'COMMIT';
$commit_failed_restore = npcink_restore($base_backup, false);
npcink_assert($commit_failed_restore instanceof WP_Error, 'restore must report transaction commit failures');
npcink_assert($commit_failed_restore->get_error_code() === 'backup_restore_failed', 'restore commit failures must use backup_restore_failed');
npcink_assert($wpdb->commands === array('START TRANSACTION', 'COMMIT', 'ROLLBACK'), 'failed restore commits must attempt a rollback');
$wpdb->fail_command = '';
$wpdb->commands = array();

$duplicate_asset = $base_backup;
$duplicate_asset['assets'][] = array(
	'id' => 11,
	'uuid' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
	'assetNumber' => 'RESTORE-FIXTURE-001',
	'name' => 'Duplicate Number',
);
$response = npcink_restore($duplicate_asset, true);
$summary = npcink_data($response)['data']['summary'];
npcink_assert(!empty($summary['conflicts']), 'dry-run should return conflict details without failing');

$response = npcink_restore($duplicate_asset, false);
npcink_assert($response instanceof WP_Error, 'real import with preview conflict should fail');
npcink_assert($response->get_error_code() === 'backup_conflicts', 'real import conflict should use backup_conflicts');
npcink_assert(isset($response->get_error_data()['status']) && $response->get_error_data()['status'] === 409, 'real import conflict should return 409');

$oversized_identities = $base_backup;
$oversized_identities['identities'] = array(
	array(
		'assetNumber' => 'RESTORE-FIXTURE-001',
		'identities' => array_fill(0, 10001, array('identityType' => 'pci_permanent_mac_v2', 'identityValue' => 'FALLBACK')),
	),
);
$response = npcink_restore($oversized_identities, true);
npcink_assert($response instanceof WP_Error, 'oversized nested identities should fail validation');
npcink_assert(isset($response->get_error_data()['status']) && $response->get_error_data()['status'] === 413, 'oversized nested identities should return 413');

$duplicate_identity = $base_backup;
$duplicate_identity['identities'] = array(
	array(
		'assetNumber' => 'RESTORE-FIXTURE-001',
		'identities' => array(
			array('identityType' => 'pci_permanent_mac_v2', 'identityValue' => 'DUPLICATE-FALLBACK'),
			array('identityType' => 'pci_permanent_mac_v2', 'identityValue' => 'DUPLICATE-FALLBACK'),
		),
	),
);
$response = npcink_restore($duplicate_identity, true);
$summary = npcink_data($response)['data']['summary'];
npcink_assert($summary['planned']['identitiesCreated'] === 1, 'duplicate identity should only plan one insert');
npcink_assert($summary['skipped']['identities'] === 1, 'duplicate identity should skip duplicate row');
npcink_assert($summary['conflicts'] === array(), 'duplicate identity on one asset must not be a conflict');

$cross_asset_identity = $base_backup;
$cross_asset_identity['assets'][] = array(
	'id' => 11,
	'uuid' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
	'assetNumber' => 'RESTORE-FIXTURE-002',
	'name' => 'Second Restore Fixture Asset',
);
$cross_asset_identity['identities'] = array(
	array(
		'assetNumber' => 'RESTORE-FIXTURE-001',
		'identities' => array(
			array('identityType' => 'system_uuid_v2', 'identityValue' => 'CROSS-ASSET-IDENTITY'),
		),
	),
	array(
		'assetNumber' => 'RESTORE-FIXTURE-002',
		'identities' => array(
			array('identityType' => 'system_uuid_v2', 'identityValue' => 'CROSS-ASSET-IDENTITY'),
		),
	),
);
$response = npcink_restore($cross_asset_identity, true);
$summary = npcink_data($response)['data']['summary'];
npcink_assert(count($summary['conflicts']) === 1, 'an identity assigned to two backup assets must be a conflict');
npcink_assert($summary['planned']['identitiesCreated'] === 1, 'cross-asset identity conflict should only plan the first insert');
npcink_assert($summary['skipped']['identities'] === 1, 'cross-asset identity conflict should skip the conflicting row');

$response = npcink_restore($cross_asset_identity, false);
npcink_assert($response instanceof WP_Error, 'real import with a cross-asset identity conflict should fail');
npcink_assert($response->get_error_code() === 'backup_conflicts', 'cross-asset identity conflict should use backup_conflicts');

$obsolete_identity = $base_backup;
$obsolete_identity['identities'] = array(
	array(
		'assetNumber' => 'RESTORE-FIXTURE-001',
		'identities' => array(
			array('identityType' => 'stable_device_id_v3', 'identityValue' => 'REMOVED-IDENTITY'),
		),
	),
);
$response = npcink_restore($obsolete_identity, true);
npcink_assert($response instanceof WP_Error && $response->get_error_code() === 'invalid_backup_identity_type', 'removed identity types must be rejected before restore');
$flat_identity = $base_backup;
$flat_identity['identities'] = array(array('assetNumber' => 'RESTORE-FIXTURE-001', 'identityType' => 'system_uuid_v2', 'identityValue' => 'flat'));
$response = npcink_restore($flat_identity, true);
npcink_assert($response instanceof WP_Error && $response->get_error_code() === 'invalid_backup_identity_group', 'historical flat identity rows must be rejected');

$obsolete_event = $base_backup;
$obsolete_event['events'] = array(
	array(
		'assetNumber' => 'RESTORE-FIXTURE-001',
		'eventSource' => 'system',
		'eventType' => 'issue_handled',
		'message' => 'Removed analysis state',
		'createdAt' => '2026-07-15 12:00:00',
	),
);
$response = npcink_restore($obsolete_event, true);
$summary = npcink_data($response)['data']['summary'];
npcink_assert($summary['planned']['eventsCreated'] === 0, 'removed workflow events must not be restored');
npcink_assert($summary['skipped']['events'] === 1, 'removed workflow events must be counted as skipped');

$missing_uuid = $base_backup;
unset($missing_uuid['assets'][0]['uuid']);
$missing_uuid['identities'] = array(
	array(
		'assetNumber' => 'RESTORE-FIXTURE-001',
		'identities' => array(
			array('identityType' => 'pci_permanent_mac_v2', 'identityValue' => 'MISSING-UUID-FALLBACK'),
		),
	),
);
$response = npcink_restore($missing_uuid, true);
$summary = npcink_data($response)['data']['summary'];
npcink_assert($summary['planned']['assetsCreated'] === 1, 'missing UUID asset should still be planned for creation');
npcink_assert($summary['planned']['identitiesCreated'] === 1, 'identity should attach to missing-UUID asset by asset number during dry-run');
npcink_assert(!empty($summary['warnings']), 'missing UUID should produce a warning');

$lookup_backup = $base_backup;
$lookup_backup['identities'] = array(array(
	'assetNumber' => 'RESTORE-FIXTURE-001',
	'identities' => array(array('identityType' => 'system_uuid_v2', 'identityValue' => 'LOOKUP-FAILURE')),
));
$lookup_backup['observations'] = array(array('assetNumber' => 'RESTORE-FIXTURE-001', 'observedAt' => '2026-07-06 00:00:00'));
$lookup_backup['events'] = array(array('assetNumber' => 'RESTORE-FIXTURE-001', 'createdAt' => '2026-07-06 00:00:00', 'message' => 'Lookup failure'));
$existing_asset = array('id' => 10, 'uuid' => $base_backup['assets'][0]['uuid'], 'asset_number' => 'RESTORE-FIXTURE-001');
$wpdb->rows['assets_by_uuid'][$existing_asset['uuid']] = $existing_asset;
$wpdb->rows['assets_by_number'][$existing_asset['asset_number']] = $existing_asset;
foreach (array('WHERE uuid =', 'WHERE asset_number =', 'SELECT asset_id', 'AND schema_version =', 'AND event_source =') as $lookup) {
	$wpdb->fail_read = $lookup;
	foreach (array(true, false) as $dry_run) {
		$wpdb->commands = array();
		$wpdb->inserts = array();
		$wpdb->fail_read_in_transaction = false;
		$failed_preview = npcink_restore($lookup_backup, $dry_run);
		npcink_assert($failed_preview instanceof WP_Error && $failed_preview->get_error_code() === 'backup_restore_failed', 'restore must report lookup failure instead of planning a missing row: ' . $lookup);
		npcink_assert($wpdb->commands === array() && $wpdb->inserts === array(), 'a failed preview lookup must prevent all writes');
	}
	$wpdb->commands = array();
	$wpdb->inserts = array();
	$wpdb->fail_read_in_transaction = true;
	$failed_import = npcink_restore($lookup_backup, false);
	npcink_assert($failed_import instanceof WP_Error && $failed_import->get_error_code() === 'backup_restore_failed', 'import must fail when a lookup breaks after a successful preview: ' . $lookup);
	npcink_assert(reset($wpdb->commands) === 'START TRANSACTION' && end($wpdb->commands) === 'ROLLBACK' && !in_array('COMMIT', $wpdb->commands, true), 'failed import lookup must roll back without committing: ' . $lookup);
}
$wpdb->fail_read = '';
$wpdb->fail_read_in_transaction = false;

$bad_schema = $base_backup;
$bad_schema['schema'] = 'wrong';
$response = npcink_restore($bad_schema, true);
npcink_assert($response instanceof WP_Error, 'bad schema should fail validation');
npcink_assert(isset($response->get_error_data()['status']) && $response->get_error_data()['status'] === 422, 'bad schema should return 422');

$receipt_backup = $base_backup;
$receipt_backup['observations'] = array(array('assetNumber' => 'RESTORE-FIXTURE-001', 'observedAt' => '2026-07-06 00:00:00', 'observationId' => 'cdb0d10b-858d-49aa-a8d4-bcb29f0cdd0e', 'payloadHash' => str_repeat('a', 64)));
$wpdb->rows['receipts'] = array('cdb0d10b-858d-49aa-a8d4-bcb29f0cdd0e' => array('asset_id' => 10, 'payload_hash' => str_repeat('b', 64)));
$conflicting_receipt = npcink_restore($receipt_backup, false);
npcink_assert($conflicting_receipt instanceof WP_Error && $conflicting_receipt->get_error_code() === 'backup_conflicts', 'receipt with different facts must block restore');
$wpdb->rows['receipts'] = array();
$receipt_backup['observations'][] = $receipt_backup['observations'][0];
$duplicate_receipt = npcink_restore($receipt_backup, true);
npcink_assert($duplicate_receipt instanceof WP_Error && $duplicate_receipt->get_error_code() === 'invalid_backup_receipt', 'duplicate backup receipt IDs must be rejected');

echo "Backup restore fixture checks passed.\n";
