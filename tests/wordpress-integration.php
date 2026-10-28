<?php
/** Run only via scripts/check-docker.sh against its disposable WordPress database. */
if (!defined('WP_CLI') || !WP_CLI || wp_get_environment_type() !== 'local' || get_option('blogname') !== 'Npcink Device Inventory Docker Check') {
	throw new RuntimeException('Integration tests require the isolated Docker test site.');
}

function npcink_integration_assert($condition, $message) {
	if (!$condition) {
		throw new RuntimeException($message);
	}
}

$assets = new Npcink_Device_Inventory_Asset_Repository();
$observations = new Npcink_Device_Inventory_Observation_Repository();
$identities = new Npcink_Device_Inventory_Identity_Repository();
$events = new Npcink_Device_Inventory_Event_Repository();
$ingest = new Npcink_Device_Inventory_Observation_Ingest_Service($assets, $identities, $observations, new Npcink_Device_Inventory_Event_Service($events), new Npcink_Device_Inventory_Device_Identity_Service());
$asset_ids = array();
$make_asset = static function ($type, $status) use ($assets, &$asset_ids) {
	$asset = $assets->create(array(
		'asset_type' => $type, 'asset_number' => 'INTEGRATION-' . wp_generate_uuid4(), 'name' => 'Integration fixture',
		'owner_name' => '', 'department' => '未分配', 'status' => $status, 'category' => '',
		'purchase_price' => 0, 'residual_value' => 0, 'financial_residual_value' => 0, 'metadata' => array(),
	));
	npcink_integration_assert(is_array($asset), 'Asset fixture creation failed.');
	$asset_ids[] = intval($asset['id']);
	return $asset;
};
$observe = static function ($asset, $date, $label) use ($observations) {
	$row = $observations->create($asset['id'], array('source' => 'integration', 'schema_version' => 1, 'observed_at' => $date,
		'summary' => array('hostname' => $label), 'hardware' => array('cpu' => array('brand' => $label)), 'raw' => array('private' => 'must-not-leak')));
	npcink_integration_assert(is_array($row), 'Observation fixture creation failed.');
	return intval($row['id']);
};

try {
	$first = $make_asset('computer', 'active');
	$second = $make_asset('computer', 'inactive');
	$archived = $make_asset('computer', 'deleted');
	$custom = $make_asset('custom', 'active');
	$observe($first, '2026-01-01 00:00:00', 'old');
	$middle_id = $observe($first, '2026-01-02 00:00:00', 'middle');
	$new_id = $observe($first, '2026-01-02 00:00:00', 'new');
	$second_id = $observe($second, '2026-01-02 00:00:00', 'second');
	$observe($archived, '2026-01-02 00:00:00', 'archived');
	$observe($custom, '2026-01-02 00:00:00', 'custom');
	wp_set_current_user(get_user_by('login', 'npcink-e2e-admin')->ID);
	$request_page = static function ($params) {
		$request = new WP_REST_Request('GET', '/npcink-device-inventory/v1/analysis/hardware-observations');
		$request->set_query_params($params);
		return rest_do_request($request);
	};
	$page = $request_page(array('afterAssetId' => $first['id'] - 1, 'pageSize' => 1));
	npcink_integration_assert($page->get_status() === 200, 'Admin analysis request failed.');
	$data = $page->get_data();
	npcink_integration_assert(array_column($data['data'], 'id') === array($new_id, $middle_id), 'Newest-two ordering/timestamp tie failed.');
	npcink_integration_assert(!array_key_exists('raw', $data['data'][0]) && !array_key_exists('raw_json', $data['data'][0]), 'Raw payload leaked.');
	npcink_integration_assert($data['pagination']['nextAfterAssetId'] === intval($first['id']), 'Cursor did not advance by asset.');
	$next = $request_page(array('afterAssetId' => $data['pagination']['nextAfterAssetId'], 'throughAssetId' => $data['pagination']['throughAssetId'], 'pageSize' => 25))->get_data();
	npcink_integration_assert(array_column($next['data'], 'id') === array($second_id) && $next['pagination']['nextAfterAssetId'] === null, 'Cursor/exclusion of archived and custom assets failed.');
	npcink_integration_assert($request_page(array('pageSize' => 26))->get_status() === 400, 'Invalid page size was accepted.');
	wp_set_current_user(0);
	npcink_integration_assert($request_page(array())->get_status() === 403, 'Anonymous analysis access was accepted.');
	$subscriber = wp_create_user('npcink-integration-subscriber', wp_generate_password(), 'subscriber@example.invalid');
	wp_set_current_user($subscriber);
	npcink_integration_assert($request_page(array())->get_status() === 403, 'Subscriber analysis access was accepted.');
	wp_set_current_user(0);
	require_once ABSPATH . 'wp-admin/includes/user.php';
	wp_delete_user($subscriber);

	// Exercise token scope through real REST permissions, not just the auth service.
	$scope_options = Npcink_Device_Inventory_V3_Tables::options();
	$scope_options['client_tokens'][] = array('id' => 'scope-agent', 'secret' => 'scope-test-secret', 'enabled' => true);
	update_option(Npcink_Device_Inventory_V3_Tables::OPTION, $scope_options);
	$signed_request = static function ($method, $route, $body = '{}') {
		$timestamp = (string) time();
		$nonce = wp_generate_uuid4();
		$payload = "npcink-device-upload-v2\n" . $method . "\n" . rtrim($route, '/') . "\nscope-agent\n" . $timestamp . "\n" . $nonce . "\n" . hash('sha256', $body);
		$request = new WP_REST_Request($method, $route);
		$request->set_body($body);
		$request->set_header('content-type', 'application/json');
		$request->set_header('x-npcink-device-signature-version', '2');
		$request->set_header('x-npcink-device-token-id', 'scope-agent');
		$request->set_header('x-npcink-device-timestamp', $timestamp);
		$request->set_header('x-npcink-device-nonce', $nonce);
		$request->set_header('x-npcink-device-signature', 'sha256=' . hash_hmac('sha256', $payload, 'scope-test-secret'));
		return $request;
	};
	$verify_route = '/npcink-device-inventory/v1/device-observations/verify';
	$verify_request = $signed_request('GET', $verify_route);
	npcink_integration_assert(rest_do_request($verify_request)->get_status() === 200, 'Signed v2 connection verification failed.');
	npcink_integration_assert(rest_do_request($verify_request)->get_status() === 401, 'Signed verify nonce replay was accepted.');
	foreach (array('/npcink-device-inventory/v1/assets', '/npcink-device-inventory/v1/settings', '/npcink-device-inventory/v1/backup', '/npcink-device-inventory/v1/analysis/hardware-observations') as $management_route) {
		npcink_integration_assert(rest_do_request($signed_request('GET', $management_route))->get_status() === 403, 'Device token gained management/read access: ' . $management_route);
	}
	$query_verify = $signed_request('GET', $verify_route);
	$query_verify->set_query_params(array('rest_route' => $verify_route));
	npcink_integration_assert(rest_do_request($query_verify)->get_status() === 200, 'Query-form WordPress route was rejected.');
	$unsigned_verify = $signed_request('GET', $verify_route);
	$unsigned_verify->set_query_params(array('extra' => '1'));
	npcink_integration_assert(rest_do_request($unsigned_verify)->get_status() === 400, 'Unsigned query parameters were accepted.');
	echo "Real signed v2 verification, replay and token scope passed.\n";

	$hardware = json_decode(file_get_contents('/workspace/tests/fixtures/device-observation-demo.json'), true);
	$nested_inventory = array('futureHardwareFact' => false, 'zeroValue' => 0, 'description' => '<USB> & literal\n  A  B', 'C:\\hardware path' => 'value');
	for ($level = 0; $level < 16; $level++) {
		$nested_inventory = array('children' => $nested_inventory);
	}
	$hardware['platformData'] = $nested_inventory;
	$hardware['volumes'] = array(array('mount' => 'C:\\', 'fsType' => 'NTFS', 'size' => 500000000000));
	$hardware['storage'] = array(
		'topology' => array('status' => 'partial', 'volumeMappings' => array(
			array('mount' => 'C:', 'diskDevices' => array('disk-a', 'disk-b'), 'partitionDevices' => array('part-a', 'part-b'), 'matchStatus' => 'matched'),
			array('mount' => 'D:', 'diskDevices' => array(), 'matchStatus' => 'ambiguous', 'reason' => 'duplicate_identifier'),
		)),
		'health' => array(array('StorageUniqueId' => 'uid-b', 'Temperature' => 32)),
		'healthMappings' => array(array('healthRecordIndex' => 0, 'storageUniqueId' => 'uid-b', 'storageSerialNumber' => 'serial-b', 'matchStatus' => 'matched')),
	);
	$hardware['graphics']['controllers'][0]['dxgiMatchStatus'] = 'ambiguous';
	$hardware['graphics']['controllers'][0]['dxgiMatchReason'] = 'ambiguous_instance_match';
	$hardware['collection'] = array('hardwareProbes' => array(array('source' => 'storage_health', 'status' => 'failed', 'error' => 'query_failed')));
	$payload = array('observation' => array(
		'_npcink_device' => array('schema_version' => 5, 'observation_id' => wp_generate_uuid4(), 'collector' => array('name' => 'integration', 'collected_at' => gmdate('c'))),
		'asset' => array('hardware' => $hardware, 'summary' => array('hostname' => 'integration-upload')),
	));
	$accepted = $ingest->ingest($payload);
	npcink_integration_assert(!is_wp_error($accepted), 'Real ingest fixture failed: ' . (is_wp_error($accepted) ? $accepted->get_error_message() : ''));
	$stored_inventory = $observations->find_by_id($accepted['data']['observation']['id']);
	$stored_hardware = json_decode($stored_inventory['hardware_json'], true);
	foreach (array('platformData', 'volumes', 'collection', 'storage', 'graphics') as $category) {
		npcink_integration_assert($stored_hardware[$category] === $hardware[$category], 'Complete hardware field was lost in real database storage: ' . $category);
	}
	$identity = (new Npcink_Device_Inventory_Device_Identity_Service())->identities($payload['observation'])[0];
	$upload_id = $identities->find_asset_id_by_identity($identity['type'], $identity['value']);
	$asset_ids[] = intval($upload_id);
	global $wpdb;
	$count = static function ($table) use ($wpdb, $upload_id) { return (int) $wpdb->get_var($wpdb->prepare('SELECT COUNT(*) FROM %i WHERE asset_id = %d', $table, $upload_id)); };
	$before_observations = $count(Npcink_Device_Inventory_V3_Tables::observations());
	$before_events = $count(Npcink_Device_Inventory_V3_Tables::events());
	$retried = $ingest->ingest($payload);
	npcink_integration_assert(!is_wp_error($retried) && $retried['data']['mode'] === 'duplicate' && $retried['data']['observation']['id'] === $accepted['data']['observation']['id'], 'Retry did not return the original receipt.');
	npcink_integration_assert($count(Npcink_Device_Inventory_V3_Tables::observations()) === $before_observations && $count(Npcink_Device_Inventory_V3_Tables::events()) === $before_events, 'Retry duplicated observation or event.');
	$changed = $payload;
	$changed['observation']['asset']['summary']['hostname'] = 'changed';
	$conflict = $ingest->ingest($changed);
	npcink_integration_assert(is_wp_error($conflict) && $conflict->get_error_code() === 'observation_id_conflict', 'Changed facts reused a receipt.');
	$stored_raw = json_decode($stored_inventory['raw_json'], true);
	npcink_integration_assert(!isset($stored_raw['asset']['hardware']) && !isset($stored_raw['hardware']), 'Hardware duplicated in raw storage.');
	npcink_integration_assert(strlen(wp_json_encode($accepted)) < 2048 && !isset($accepted['data']['observation']['hardware']), 'Upload receipt echoed full inventory.');
	$payload['observation']['_npcink_device']['observation_id'] = wp_generate_uuid4();
	// Inject a real database error only into the latest-pointer UPDATE, after the observation INSERT.
	$fail_update = static function ($query) use ($wpdb) {
		return strpos($query, 'SET updated_at = updated_at, latest_observation_id =') !== false ? 'UPDATE npcink_deliberately_missing_table SET id = 1' : $query;
	};
	add_filter('query', $fail_update);
	$previous_suppression = $wpdb->suppress_errors(true);
	try { $failed = $ingest->ingest($payload); }
	finally { remove_filter('query', $fail_update); $wpdb->suppress_errors($previous_suppression); }
	npcink_integration_assert(is_wp_error($failed) && $failed->get_error_code() === 'observation_create_failed', 'Failed latest-pointer update was acknowledged.');
	npcink_integration_assert($count(Npcink_Device_Inventory_V3_Tables::observations()) === $before_observations && $count(Npcink_Device_Inventory_V3_Tables::events()) === $before_events, 'MariaDB rollback left observation/event writes behind.');

	// A row read inside the transaction must disappear from ID caches after rollback.
	$wpdb->query('START TRANSACTION');
	$rolled_back_id = $observe($assets->find_by_id($upload_id), gmdate('Y-m-d H:i:s'), 'rolled-back');
	$wpdb->query('ROLLBACK');
	$assets->invalidate_cache();
	$observations->invalidate_cache();
	npcink_integration_assert($observations->find_by_id($rolled_back_id) === null, 'Rolled-back observation survived in the ID cache.');

	// Failure to promote the primary identity must abort every ingest write.
	$fail_primary = static function ($query) {
		return strpos($query, 'SET is_primary = CASE') !== false ? 'UPDATE npcink_deliberately_missing_table SET id = 1' : $query;
	};
	add_filter('query', $fail_primary);
	$previous_suppression = $wpdb->suppress_errors(true);
	try { $failed_primary = $ingest->ingest($payload); }
	finally { remove_filter('query', $fail_primary); $wpdb->suppress_errors($previous_suppression); }
	npcink_integration_assert(is_wp_error($failed_primary) && $failed_primary->get_error_code() === 'identity_claim_failed', 'Failed primary update was acknowledged.');
	npcink_integration_assert($count(Npcink_Device_Inventory_V3_Tables::observations()) === $before_observations && $count(Npcink_Device_Inventory_V3_Tables::events()) === $before_events, 'Failed primary update left observation/event writes behind.');

	// Another connection can cache the previous committed state after pre-commit invalidation.
	// Simulate that reader just before COMMIT using the same object-cache namespace.
	$read_before_commit = static function ($query) use ($assets, $observations, $events, $upload_id) {
		if (trim($query) === 'COMMIT') {
			$transaction_db = $GLOBALS['wpdb'];
			$pending_latest = $transaction_db->get_var($transaction_db->prepare('SELECT latest_observation_id FROM %i WHERE id = %d', Npcink_Device_Inventory_V3_Tables::assets(), $upload_id));
			$reader_db = new wpdb(DB_USER, DB_PASSWORD, DB_NAME, DB_HOST);
			$reader_db->set_prefix($transaction_db->prefix);
			$GLOBALS['wpdb'] = $reader_db;
			try {
				$cached_asset = $assets->find_by_id($upload_id);
				npcink_integration_assert(is_array($cached_asset) && !$reader_db->last_error, 'Independent reader must read the actual plugin tables.');
				npcink_integration_assert(intval($cached_asset['latest_observation_id']) !== intval($pending_latest), 'Independent reader must cache the previous committed snapshot.');
				$observations->list_for_asset($upload_id, 1, 100);
				$events->list_for_asset($upload_id, 1, 100);
			} finally {
				$GLOBALS['wpdb'] = $transaction_db;
				$reader_db->close();
			}
		}
		return $query;
	};
	add_filter('query', $read_before_commit);
	try { $committed = $ingest->ingest($payload); }
	finally { remove_filter('query', $read_before_commit); }
	npcink_integration_assert(!is_wp_error($committed), 'Cache-race ingest did not commit.');
	npcink_integration_assert(intval($assets->find_by_id($upload_id)['latest_observation_id']) === $committed['data']['observation']['id'], 'Committed latest pointer hidden by pre-commit reader cache.');
	npcink_integration_assert($observations->list_for_asset($upload_id, 1, 100)['total'] === $before_observations + 1, 'Committed observation list remained stale.');
	npcink_integration_assert($events->list_for_asset($upload_id, 1, 100)['total'] === $before_events + 1, 'Committed event list remained stale.');
	$before_observations++;
	$before_events++;

	// Restoring receipt IDs must preserve distinct collections with the same timestamp.
	$receipt_controller = new Npcink_Device_Inventory_Backup_Restore_Controller();
	$receipt_export_request = new WP_REST_Request('GET', '/');
	$receipt_export_request->set_param('sections', 'assets,observations');
	$receipt_export = $receipt_controller->export_backup($receipt_export_request)->get_data()['data']['backup'];
	$receipt_backup = array('schema' => $receipt_export['schema'],
		'assets' => array_values(array_filter($receipt_export['assets'], static function ($row) use ($upload_id) { return intval($row['id']) === intval($upload_id); })),
		'observations' => array_values(array_filter($receipt_export['observations'], static function ($row) use ($upload_id) { return intval($row['assetId']) === intval($upload_id); })));
	npcink_integration_assert(count($receipt_backup['observations']) === $before_observations && !empty($receipt_backup['observations'][0]['observationId']), 'Export lost receipt metadata.');
	$exported_original = array_values(array_filter($receipt_backup['observations'], static function ($row) use ($payload) { return $row['observationId'] === $payload['observation']['_npcink_device']['observation_id']; }));
	npcink_integration_assert(count($exported_original) === 1 && $exported_original[0]['hardware']['storage'] === $hardware['storage'], 'Backup export lost storage relationships.');
	$wpdb->delete(Npcink_Device_Inventory_V3_Tables::observations(), array('asset_id' => $upload_id));
	$observations->invalidate_cache();
	$restore_receipts_request = new WP_REST_Request('POST', '/');
	$restore_receipts_request->set_header('content-type', 'application/json');
	$restore_receipts_request->set_body(wp_json_encode(array('backup' => $receipt_backup, 'dryRun' => false)));
	$restored_receipts = $receipt_controller->restore_backup($restore_receipts_request);
	npcink_integration_assert(!is_wp_error($restored_receipts), 'Receipt restore failed.');
	npcink_integration_assert($count(Npcink_Device_Inventory_V3_Tables::observations()) === $before_observations, 'Restore merged collections that shared a timestamp.');
	$restored_retry = $ingest->ingest($payload);
	npcink_integration_assert(!is_wp_error($restored_retry) && $restored_retry['data']['mode'] === 'duplicate', 'Restore lost retry idempotency.');
	npcink_integration_assert($count(Npcink_Device_Inventory_V3_Tables::observations()) === $before_observations && $count(Npcink_Device_Inventory_V3_Tables::events()) === $before_events, 'Restored receipt retry duplicated data.');
	$restored_inventory = $observations->find_by_id($restored_retry['data']['observation']['id']);
	$restored_hardware = json_decode($restored_inventory['hardware_json'], true);
	npcink_integration_assert($restored_hardware['storage'] === $hardware['storage'] && $restored_hardware['graphics'] === $hardware['graphics'], 'Backup restore lost component relations or graphics diagnostics.');
	echo "Real receipt export/restore and retry idempotency passed.\n";

	// Failed wpdb reads can look exactly like empty result sets. Never export or
	// restore successfully when a section read or a duplicate lookup fails.
	$backup_controller = new Npcink_Device_Inventory_Backup_Restore_Controller();
	$export_request = new WP_REST_Request('GET', '/');
	$export_request->set_param('sections', 'assets');
	$valid_export = $backup_controller->export_backup($export_request)->get_data()['data']['backup'];
	$restore_backup = array('schema' => $valid_export['schema'], 'assets' => array($valid_export['assets'][0]));
	$restore_backup['assets'][0]['name'] = 'Must roll back after a later lookup fails';
	$restore_backup['observations'] = array(array('assetNumber' => $restore_backup['assets'][0]['assetNumber'], 'observedAt' => '2026-01-01 00:00:00'));
	$original_name = $valid_export['assets'][0]['name'];
	foreach (array('export', 'preview', 'import') as $failure_stage) {
		$started = false;
		$injected = false;
		$fail_backup_read = static function ($query) use ($failure_stage, &$started, &$injected) {
			if (trim($query) === 'START TRANSACTION') { $started = true; }
			$matches = $failure_stage === 'export' ? strpos($query, 'SELECT id, uuid, asset_type') === 0
				: ($failure_stage === 'preview' ? strpos($query, 'WHERE uuid =') !== false
				: $started && strpos($query, 'AND schema_version =') !== false);
			if ($matches) {
				$injected = true;
				return 'SELECT * FROM npcink_deliberately_missing_backup_table';
			}
			return $query;
		};
		$previous_suppress = $wpdb->suppress_errors(true);
		add_filter('query', $fail_backup_read);
		try {
			if ($failure_stage === 'export') {
				$failed_backup = $backup_controller->export_backup($export_request);
			} else {
				$restore_request = new WP_REST_Request('POST', '/');
				$restore_request->set_header('content-type', 'application/json');
				$restore_request->set_body(wp_json_encode(array('backup' => $restore_backup, 'dryRun' => $failure_stage === 'preview')));
				$failed_backup = $backup_controller->restore_backup($restore_request);
			}
		} finally {
			remove_filter('query', $fail_backup_read);
			$wpdb->suppress_errors($previous_suppress);
		}
		npcink_integration_assert($injected, 'Backup SQL failure injection did not run: ' . $failure_stage);
		npcink_integration_assert(is_wp_error($failed_backup) && $failed_backup->get_error_code() === ($failure_stage === 'export' ? 'backup_export_failed' : 'backup_restore_failed'), 'Backup SQL failure was reported as success: ' . $failure_stage);
		$name = $wpdb->get_var($wpdb->prepare('SELECT name FROM %i WHERE id = %d', Npcink_Device_Inventory_V3_Tables::assets(), $restore_backup['assets'][0]['id']));
		npcink_integration_assert($name === $original_name, 'Failed restore did not roll back an earlier asset update.');
	}
	echo "Real backup export, preview and import read-failure rollback passed.\n";

	// Commit an archive on an independent connection immediately before ingest starts its transaction.
	// The first asset lookup is already cached as active; the locking read must bypass that cache.
	$assets->find_by_id($upload_id);
	$archive_on_begin = static function ($query) use ($wpdb, $upload_id) {
		if (trim($query) === 'START TRANSACTION') {
			$other = new wpdb(DB_USER, DB_PASSWORD, DB_NAME, DB_HOST);
			$other->update(Npcink_Device_Inventory_V3_Tables::assets(), array('status' => 'deleted'), array('id' => $upload_id));
			$other->close();
		}
		return $query;
	};
	add_filter('query', $archive_on_begin);
	try { $rejected = $ingest->ingest($payload); }
	finally { remove_filter('query', $archive_on_begin); }
	npcink_integration_assert(is_wp_error($rejected) && $rejected->get_error_code() === 'asset_archived', 'Concurrent archive was bypassed.');
	npcink_integration_assert($count(Npcink_Device_Inventory_V3_Tables::observations()) === $before_observations, 'Archive race inserted an observation.');
	$payload['observation']['_npcink_device']['collector']['collected_at'] = '2099-01-01T00:00:00Z';
	$future = $ingest->ingest($payload);
	npcink_integration_assert(is_wp_error($future) && $future->get_error_code() === 'invalid_observation_time', 'Future timestamp accepted.');
	echo "Real REST permissions, latest-two cursor SQL, rollback, archive race and clock validation passed.\n";
} finally {
	global $wpdb;
	foreach ($asset_ids as $id) {
		foreach (array(Npcink_Device_Inventory_V3_Tables::events(), Npcink_Device_Inventory_V3_Tables::observations(), Npcink_Device_Inventory_V3_Tables::identities()) as $table) {
			$wpdb->delete($table, array('asset_id' => $id));
		}
		$wpdb->delete(Npcink_Device_Inventory_V3_Tables::assets(), array('id' => $id));
	}
}

// Lifecycle tests are deliberately destructive only within the disposable database.
require_once WP_PLUGIN_DIR . '/npcink-device-inventory/admin/partials/npcink-device-inventory-admin-uninstall.php';
require_once WP_PLUGIN_DIR . '/npcink-device-inventory/includes/class-npcink-device-inventory-activator.php';
$tables = array(Npcink_Device_Inventory_V3_Tables::assets(), Npcink_Device_Inventory_V3_Tables::identities(), Npcink_Device_Inventory_V3_Tables::observations(), Npcink_Device_Inventory_V3_Tables::events());
$table_exists = static function ($table) use ($wpdb) { return $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) === $table; };
$security_row_count = static function () use ($wpdb) {
	return (int) $wpdb->get_var($wpdb->prepare('SELECT COUNT(*) FROM %i WHERE option_name LIKE %s OR option_name LIKE %s', $wpdb->options, $wpdb->esc_like('npcink_v3_upload_nonce_') . '%', $wpdb->esc_like('npcink_v3_upload_rate_') . '%'));
};
update_option('npcinkXv3XuploadXnonce_sentinel', 'unrelated');
update_option('npcinkXv3XuploadXrate_sentinel', 'unrelated');
$security_before = $security_row_count();
npcink_integration_assert($security_before > 0, 'Token scope fixture did not establish replay/rate rows.');
Npcink_Device_Inventory_Admin_Uninstall::run();
foreach ($tables as $table) { npcink_integration_assert($table_exists($table), 'Default uninstall deleted a table.'); }
npcink_integration_assert($security_row_count() === $security_before, 'Default uninstall removed replay/rate protections.');
$options = Npcink_Device_Inventory_V3_Tables::options();
$options['delete_data_on_uninstall'] = true;
update_option(Npcink_Device_Inventory_V3_Tables::OPTION, $options);
Npcink_Device_Inventory_Admin_Uninstall::run();
foreach ($tables as $table) { npcink_integration_assert(!$table_exists($table), 'Opt-in uninstall retained a table.'); }
npcink_integration_assert(get_option('npcink_device_inventory_schema_revision', null) === null, 'Uninstall retained schema revision.');
npcink_integration_assert($security_row_count() === 0, 'Opt-in uninstall retained replay/rate rows.');
npcink_integration_assert(get_option('npcinkXv3XuploadXnonce_sentinel') === 'unrelated' && get_option('npcinkXv3XuploadXrate_sentinel') === 'unrelated', 'Uninstall wildcard matched unrelated option names.');
delete_option('npcinkXv3XuploadXnonce_sentinel');
delete_option('npcinkXv3XuploadXrate_sentinel');
npcink_integration_assert(Npcink_Device_Inventory_Activator::run() !== false, 'Reinstall failed.');
foreach ($tables as $table) { npcink_integration_assert($table_exists($table), 'Reinstall did not create a table.'); }
$wpdb->query($wpdb->prepare('DROP TABLE %i', Npcink_Device_Inventory_V3_Tables::events()));
npcink_integration_assert(Npcink_Device_Inventory_Activator::run() !== false && $table_exists(Npcink_Device_Inventory_V3_Tables::events()), 'Stale-revision repair failed.');
echo "Real uninstall/reinstall and stale-revision table repair passed.\n";
