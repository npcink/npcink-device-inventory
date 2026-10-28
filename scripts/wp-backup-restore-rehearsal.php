<?php

if (!defined('ABSPATH')) {
	fwrite(STDERR, "Run this file with WP-CLI: wp eval-file scripts/wp-backup-restore-rehearsal.php\n");
	exit(1);
}

global $wpdb;

$run_id = substr(str_replace('-', '', wp_generate_uuid4()), 0, 12);
$prefix = 'RESTORE-E2E-' . gmdate('YmdHis') . '-' . $run_id;
$asset_number = $prefix . '-001';
$conflict_asset_number = $prefix . '-002';
$asset_uuid = wp_generate_uuid4();
$conflict_uuid = wp_generate_uuid4();
$identity_value = 'device-v1-' . substr(hash('sha256', $prefix), 0, 29);
$root_dir = getenv('NPCINK_RESTORE_REHEARSAL_ROOT');

if (!$root_dir || !is_dir($root_dir)) {
	fwrite(STDERR, "NPCINK_RESTORE_REHEARSAL_ROOT is required.\n");
	exit(1);
}

if (!function_exists('rest_do_request')) {
	fwrite(STDERR, "WordPress REST API is not available.\n");
	exit(1);
}

$admins = get_users(array('role' => 'administrator', 'number' => 1, 'fields' => 'ID'));
if (empty($admins)) {
	fwrite(STDERR, "No administrator user found.\n");
	exit(1);
}
wp_set_current_user((int) $admins[0]);
rest_get_server();

if (!class_exists('Npcink_Device_Inventory_V3_Tables')) {
	fwrite(STDERR, "Npcink Device Inventory plugin is not loaded. Activate it before running this rehearsal.\n");
	exit(1);
}

$previous_options = get_option(Npcink_Device_Inventory_V3_Tables::OPTION, array());

$cleanup_complete = false;
$cleanup = function () use ($wpdb, $previous_options, $asset_number, $conflict_asset_number, &$cleanup_complete) {
	if ($cleanup_complete) {
		return;
	}

	$assets_table = Npcink_Device_Inventory_V3_Tables::assets();
	$identities_table = Npcink_Device_Inventory_V3_Tables::identities();
	$observations_table = Npcink_Device_Inventory_V3_Tables::observations();
	$events_table = Npcink_Device_Inventory_V3_Tables::events();
	$wpdb->last_error = '';
	$asset_ids = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT id FROM {$assets_table} WHERE asset_number IN (%s, %s)",
			$asset_number,
			$conflict_asset_number
		)
	);
	if ($wpdb->last_error !== '') {
		throw new RuntimeException('Failed to locate backup restore rehearsal assets during cleanup.');
	}
	if (!empty($asset_ids)) {
		$asset_ids = array_map('intval', $asset_ids);
		foreach ($asset_ids as $asset_id) {
			foreach (array($events_table, $observations_table, $identities_table) as $table) {
				if ($wpdb->delete($table, array('asset_id' => $asset_id), array('%d')) === false) {
					throw new RuntimeException('Failed to delete backup restore rehearsal child rows.');
				}
			}
			if ($wpdb->delete($assets_table, array('id' => $asset_id), array('%d')) !== 1) {
				throw new RuntimeException('Failed to delete a backup restore rehearsal asset.');
			}
		}
	}
	if (is_array($previous_options) && get_option(Npcink_Device_Inventory_V3_Tables::OPTION, array()) !== $previous_options) {
		$restored = update_option(Npcink_Device_Inventory_V3_Tables::OPTION, $previous_options);
		if (!$restored && get_option(Npcink_Device_Inventory_V3_Tables::OPTION, array()) !== $previous_options) {
			throw new RuntimeException('Failed to restore plugin options after backup restore rehearsal.');
		}
	}

	$cleanup_complete = true;
};
register_shutdown_function($cleanup);

$request_restore = function ($backup, $dry_run) {
	$request = new WP_REST_Request('POST', '/npcink-device-inventory/v1/backup-restore');
	$request->set_header('content-type', 'application/json');
	$request->set_body(wp_json_encode(array('backup' => $backup, 'dryRun' => $dry_run)));
	$response = rest_do_request($request);
	if (is_wp_error($response)) {
		return $response;
	}
	return $response instanceof WP_REST_Response ? $response->get_data() : $response;
};

$assert = function ($condition, $message) {
	if (!$condition) {
		throw new RuntimeException("Backup restore rehearsal failed: {$message}");
	}
};

$backup = array(
	'schema' => 'npcink-device-inventory/v3-admin-export',
	'exportedAt' => gmdate('c'),
	'settings' => array(
		'observationRetentionDays' => 30,
		'assetNumberPrefix' => 'E2E',
		'depreciationPeriodMonths' => 24,
		'defaultResidualRate' => 8,
		'countAvailableAssetsOnly' => true,
	),
	'assets' => array(
		array(
			'id' => 1,
			'uuid' => $asset_uuid,
			'assetType' => 'computer',
			'assetNumber' => $asset_number,
			'name' => 'Restore E2E Asset',
			'ownerName' => 'Restore E2E',
			'department' => 'QA',
			'status' => 'active',
			'category' => 'Laptop',
			'purchasePrice' => 100,
			'secondHandMarketValue' => 10,
			'residualValue' => 999,
			'financialResidualValue' => 35,
			'metadata' => array('restoreRehearsal' => true),
			'createdAt' => '2026-07-06T00:00:00+00:00',
			'updatedAt' => '2026-07-06T00:00:00+00:00',
		),
	),
	'identities' => array(
		array(
			'assetNumber' => $asset_number,
			'identities' => array(
				array('identityType' => 'system_uuid_v2', 'identityValue' => $identity_value, 'confidence' => 100, 'isPrimary' => true),
				array('identityType' => 'device_uuid_v1', 'identityValue' => 'device-v1-rehearsal'),
				array('identityType' => 'fallback_device_v1', 'identityValue' => 'fallback-v1-rehearsal'),
			),
		),
	),
	'observations' => array(
		array(
			'assetNumber' => $asset_number,
			'source' => 'restore_e2e',
			'schemaVersion' => 3,
			'observedAt' => '2026-07-06T00:20:00+00:00',
			'receivedAt' => '2026-07-06T00:21:00+00:00',
			'summary' => array('deviceName' => 'restore-e2e-latest'),
			'hardware' => array('cpu' => array('model' => 'fixture-latest')),
			'raw' => array('restoreRehearsal' => true, 'sequence' => 2),
		),
		array(
			'assetNumber' => $asset_number,
			'source' => 'restore_e2e',
			'schemaVersion' => 3,
			'observedAt' => '2026-07-06T00:10:00+00:00',
			'receivedAt' => '2026-07-06T00:11:00+00:00',
			'summary' => array('deviceName' => 'restore-e2e'),
			'hardware' => array('cpu' => array('model' => 'fixture')),
			'raw' => array('restoreRehearsal' => true, 'sequence' => 1),
		),
	),
	'events' => array(
		array(
			'assetNumber' => $asset_number,
			'eventSource' => 'restore_e2e',
			'eventType' => 'note',
			'message' => 'Restore rehearsal event',
			'payload' => array('restoreRehearsal' => true),
			'createdAt' => '2026-07-06T00:12:00+00:00',
		),
	),
);

$preview = $request_restore($backup, true);
$assert(is_array($preview) && empty($preview['data']['summary']['conflicts']), 'dry-run preview should succeed without conflicts');
$assert((int) $preview['data']['summary']['planned']['assetsCreated'] === 1, 'dry-run should plan one asset create');
$assert((int) $preview['data']['summary']['planned']['identitiesCreated'] === 1, 'dry-run should plan one identity create');

$assert((int) $preview['data']['summary']['skipped']['identities'] === 2, 'preview should explain the discarded v1 identities');

$import = $request_restore($backup, false);
$assert(is_array($import) && (int) $import['data']['summary']['imported']['assetsCreated'] === 1, 'import should create one asset');
$assert((int) $import['data']['summary']['imported']['identitiesCreated'] === 1, 'import should create one identity');
$assert((int) $import['data']['summary']['imported']['observationsCreated'] === 2, 'import should create both observations');
$assert((int) $import['data']['summary']['imported']['eventsCreated'] === 1, 'import should create one event');

$assets_table = Npcink_Device_Inventory_V3_Tables::assets();
$observations_table = Npcink_Device_Inventory_V3_Tables::observations();
$restored_asset = $wpdb->get_row(
	$wpdb->prepare("SELECT id, residual_value, financial_residual_value, latest_observation_id, latest_observed_at FROM {$assets_table} WHERE asset_number = %s LIMIT 1", $asset_number),
	ARRAY_A
);
$assert((float) $restored_asset['residual_value'] === 10.0 && (float) $restored_asset['financial_residual_value'] === 35.0, '3.2.3 restore must use canonical market and financial values');
$assert((int) $import['data']['summary']['skipped']['identities'] === 2, 'import must discard v1 identities');
$restored_observation = $wpdb->get_row(
	$wpdb->prepare(
		"SELECT id, observed_at FROM {$observations_table} WHERE asset_id = %d ORDER BY observed_at DESC, id DESC LIMIT 1",
		(int) $restored_asset['id']
	),
	ARRAY_A
);
$assert((int) $restored_asset['latest_observation_id'] === (int) $restored_observation['id'], 'import should point the asset to its latest observation');
$assert((string) $restored_asset['latest_observed_at'] === (string) $restored_observation['observed_at'], 'import should preserve the latest observation timestamp');
$assert((string) $restored_observation['observed_at'] === '2026-07-06 00:20:00', 'out-of-order import should select the chronologically latest observation');

$cleared = $wpdb->query(
	$wpdb->prepare(
		"UPDATE {$assets_table} SET latest_observation_id = NULL, latest_observed_at = NULL WHERE id = %d",
		(int) $restored_asset['id']
	)
);
$assert($cleared === 1, 'test setup should clear the latest observation pointer');

$repair_import = $request_restore($backup, false);
$assert(is_array($repair_import) && (int) $repair_import['data']['summary']['imported']['observationsCreated'] === 0, 'repeat import should not duplicate observations');
$repaired_asset = $wpdb->get_row(
	$wpdb->prepare("SELECT latest_observation_id, latest_observed_at FROM {$assets_table} WHERE id = %d", (int) $restored_asset['id']),
	ARRAY_A
);
$assert((int) $repaired_asset['latest_observation_id'] === (int) $restored_observation['id'], 'repeat import should repair a missing latest observation pointer');
$assert((string) $repaired_asset['latest_observed_at'] === (string) $restored_observation['observed_at'], 'repeat import should repair the latest observation timestamp');

$second_preview = $request_restore($backup, true);
$assert(is_array($second_preview) && (int) $second_preview['data']['summary']['planned']['assetsUpdated'] === 1, 'second dry-run should plan asset update');
$assert((int) $second_preview['data']['summary']['planned']['identitiesExisting'] === 1, 'second dry-run should identify existing identity');

$conflict_backup = $backup;
$conflict_backup['assets'] = array(
	array(
		'id' => 2,
		'uuid' => $conflict_uuid,
		'assetNumber' => $conflict_asset_number,
		'name' => 'Restore E2E Conflict Asset',
	),
);
$conflict_backup['identities'] = array(
	array(
		'assetNumber' => $conflict_asset_number,
		'identities' => array(
			array('identityType' => 'system_uuid_v2', 'identityValue' => $identity_value),
		),
	),
);

$conflict_preview = $request_restore($conflict_backup, true);
$assert(is_array($conflict_preview) && !empty($conflict_preview['data']['summary']['conflicts']), 'conflict dry-run should expose conflicts');

$conflict_import = $request_restore($conflict_backup, false);
$assert(is_array($conflict_import), 'conflict import should return a REST error response');
$assert(isset($conflict_import['code']) && $conflict_import['code'] === 'backup_conflicts', 'conflict import should use backup_conflicts');
$assert(isset($conflict_import['data']['status']) && (int) $conflict_import['data']['status'] === 409, 'conflict import should return 409');

$cleanup();

echo "Backup restore rehearsal verified {$asset_number}.\n";
