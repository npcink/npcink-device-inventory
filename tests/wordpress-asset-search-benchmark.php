<?php
/** Optional measurement for a fresh, disposable WordPress/MariaDB test site. */
if (!defined('WP_CLI') || !WP_CLI || wp_get_environment_type() !== 'local' || get_option('blogname') !== 'Npcink Device Inventory Docker Check') {
	throw new RuntimeException('Asset search benchmark requires the isolated Docker test site.');
}

global $wpdb;
$assets = Npcink_Device_Inventory_V3_Tables::assets();
$observations = Npcink_Device_Inventory_V3_Tables::observations();
$identities = Npcink_Device_Inventory_V3_Tables::identities();
foreach (array($assets, $observations, $identities) as $table) {
	if (!in_array($wpdb->get_var($wpdb->prepare('SELECT COUNT(*) FROM %i', $table)), array('0', 0), true)) {
		throw new RuntimeException('Benchmark requires empty inventory tables.');
	}
}

$admin = get_user_by('login', 'npcink-e2e-admin');
if (!$admin || $wpdb->query('START TRANSACTION') === false) {
	throw new RuntimeException('Could not start the isolated benchmark.');
}
wp_set_current_user($admin->ID);
$insert = static function ($table, $row) use ($wpdb) {
	if ($wpdb->insert($table, $row) !== 1) {
		throw new RuntimeException('Synthetic benchmark insert failed.');
	}
	return $wpdb->insert_id;
};
$hardware = wp_json_encode(array('cpu' => array('brand' => 'Synthetic CPU'), 'padding' => str_repeat('x', 32768)));
$read = static function ($search, $full = false) {
	wp_cache_flush();
	$request = new WP_REST_Request('GET', '/npcink-device-inventory/v1/assets');
	$request->set_query_params(array('assetScope' => 'all', 'pageSize' => 20, 'search' => $search, 'includeHardware' => $full));
	$start = hrtime(true);
	$response = rest_do_request($request);
	$data = $response->get_data();
	$bytes = strlen(wp_json_encode($data));
	if ($response->get_status() !== 200) {
		throw new RuntimeException('Benchmark list did not return HTTP 200.');
	}
	return array($data, (hrtime(true) - $start) / 1e6, $bytes);
};

try {
	for ($index = 1; $index <= 1500; $index++) {
		$is_computer = $index <= 1200;
		$asset_id = $insert($assets, array(
			'uuid' => wp_generate_uuid4(), 'asset_number' => sprintf('BENCH-%04d', $index),
			'asset_type' => $is_computer ? 'computer' : 'custom', 'name' => 'Bench inventory',
			'department' => sprintf('BenchDept-%02d', $index % 15), 'status' => 'active',
		));
		if (!$is_computer) {
			continue;
		}
		$insert($identities, array('asset_id' => $asset_id, 'identity_type' => 'baseboard_serial_v2', 'identity_value' => sprintf('BENCHSER%04d', $index)));
		$observed_at = '2026-01-01 00:00:00';
		$observation_id = $insert($observations, array(
			'asset_id' => $asset_id, 'source' => 'benchmark', 'observed_at' => $observed_at,
			'summary_json' => wp_json_encode(array('hostname' => sprintf('benchhost%04d', $index))), 'hardware_json' => $hardware,
		));
		if ($wpdb->update($assets, array('latest_observation_id' => $observation_id, 'latest_observed_at' => $observed_at), array('id' => $asset_id)) !== 1) {
			throw new RuntimeException('Synthetic latest observation update failed.');
		}
	}
	foreach (array('BENCH-0001' => 1, 'BenchDept-03' => 100, 'BENCHSER0088' => 1, 'benchhost0088' => 1, 'benchmissing' => 0) as $search => $expected) {
		$timings = array();
		for ($run = 0; $run < 7; $run++) {
			list($data, $elapsed, $bytes) = $read($search);
			if ($data['pagination']['totalItems'] !== $expected) {
				throw new RuntimeException('Unexpected synthetic search count for ' . $search);
			}
			$timings[] = $elapsed;
		}
		sort($timings);
		printf("Search %-15s total=%3d median=%.1f ms max=%.1f ms json=%d bytes\n", $search, $expected, $timings[3], $timings[6], $bytes);
	}
	list($light, , $light_bytes) = $read('BENCH-00');
	list($full, , $full_bytes) = $read('BENCH-00', true);
	if (count($light['data']) !== 20 || array_column($light['data'], 'id') !== array_column($full['data'], 'id') || isset($light['data'][0]['latestObservation']['hardware']) || !isset($full['data'][0]['latestObservation']['hardware'])) {
		throw new RuntimeException('Hardware projection changed result membership or returned the wrong fields.');
	}
	printf("Projection, same 20 assets: summary=%d bytes hardware=%d bytes\n", $light_bytes, $full_bytes);
} finally {
	$wpdb->query('ROLLBACK');
	wp_cache_flush();
}
