<?php

define('ABSPATH', __DIR__ . '/');

function sanitize_key($value)
{
	return strtolower(preg_replace('/[^a-z0-9_\-]/', '', (string) $value));
}

function sanitize_text_field($value)
{
	return trim((string) $value);
}

function wp_json_encode($value) { return json_encode($value); }

function current_time()
{
	return '2026-07-15 12:00:00';
}

function is_wp_error($value) { return $value instanceof WP_Error; }

class WP_Error
{
	public $code;

	public function __construct($code)
	{
		$this->code = $code;
	}
}

class Npcink_Device_Inventory_V3_Response
{
	public static function error($code)
	{
		return new WP_Error($code);
	}
}

class Npcink_Device_Inventory_Asset_Repository
{
	public $assets;
	public $created_asset_id = 99;
	public $cache_invalidations = 0;

	public function __construct($assets)
	{
		$this->assets = $assets;
	}

	public function find_by_id_for_update($id) { return $this->find_by_id($id); }

	public function find_by_id($id)
	{
		return isset($this->assets[$id]) ? $this->assets[$id] : null;
	}

	public function create($data)
	{
		$asset = npcink_ingest_asset_row($this->created_asset_id, 'created-asset');
		$asset['owner_name'] = $data['owner_name'];
		$this->assets[$this->created_asset_id] = $asset;
		return $asset;
	}

	public function update($uuid, $data)
	{
		foreach ($this->assets as $id => $asset) {
			if ($asset['uuid'] !== $uuid) {
				continue;
			}
			$this->assets[$id] = array_merge($asset, $data);
			return $this->assets[$id];
		}
		return null;
	}

	public function invalidate_cache()
	{
		$this->cache_invalidations++;
	}
}

class Npcink_Device_Inventory_Identity_Repository
{
	const CLAIM_INSERTED = 'inserted';
	const CLAIM_OWNED = 'owned';
	const CLAIM_CONFLICT = 'conflict';
	const CLAIM_INVALID = 'invalid';
	const CLAIM_ERROR = 'error';

	public $claim_batches = array();
	public $claimed_asset_ids = array();
	public $claimed_identities = array();
	public $matched_asset_id;
	public $matched_asset_ids = array();
	public $cache_invalidations = 0;
	public function invalidate_cache() { $this->cache_invalidations++; }

	public function find_asset_id_by_identity($type = '', $value = '')
	{
		$key = $type . ':' . $value;
		if (array_key_exists($key, $this->matched_asset_ids)) {
			return $this->matched_asset_ids[$key];
		}
		return $this->matched_asset_id;
	}

	public function find_asset_id_by_identities()
	{
		return $this->matched_asset_id;
	}

	public function claim_many($asset_id, $identities)
	{
		$this->claimed_asset_ids[] = intval($asset_id);
		$this->claimed_identities[] = $identities;
		if (!empty($this->claim_batches)) {
			return array_shift($this->claim_batches);
		}
		return array(npcink_ingest_claim(self::CLAIM_INSERTED, $asset_id));
	}

	public function list_for_asset($asset_id)
	{
		return array(
			array(
				'id' => 1,
				'asset_id' => intval($asset_id),
				'identity_type' => 'system_uuid_v2',
				'identity_value' => 'system-v2-fixture',
				'confidence' => 100,
				'is_primary' => 1,
				'source' => 'fixture',
				'created_at' => '2026-07-15 12:00:00',
			),
		);
	}
}

class Npcink_Device_Inventory_Observation_Repository
{
	public $fail_create = false;
	public $created_asset_ids = array();
	public $cache_invalidations = 0;
	public $rows = array();

	public function __construct($rows = array())
	{
		$this->rows = $rows;
	}

	public $receipt = null;
	public $last_created;
	public function find_by_upload_id($uuid) { return $this->receipt; }
	public function create($asset_id, $input)
	{
		if ($this->fail_create) { return null; }
		$this->created_asset_ids[] = intval($asset_id);
		$this->last_created = array(
			'id' => 501,
			'asset_id' => intval($asset_id),
			'source' => 'fixture',
			'schema_version' => 5,
			'observation_uuid' => $input['observation_uuid'],
			'payload_hash' => $input['payload_hash'],
			'observed_at' => '2026-07-15 12:00:00',
			'received_at' => '2026-07-15 12:00:01',
			'summary_json' => '{}',
			'hardware_json' => '{}',
			'raw_json' => '{}',
		);
		return $this->last_created;
	}

	public function invalidate_cache()
	{
		$this->cache_invalidations++;
	}

	public function find_by_id($id)
	{
		return isset($this->rows[$id]) ? $this->rows[$id] : null;
	}
}

class Npcink_Device_Inventory_Event_Service
{
	public $events = array();
	public $fail_type = '';
	public $cache_invalidations = 0;
	public function invalidate_cache() { $this->cache_invalidations++; }

	public function record($asset_id, $source, $type)
	{
		$this->events[] = array('assetId' => intval($asset_id), 'source' => $source, 'type' => $type);
		return $type !== $this->fail_type;
	}
}

class Npcink_Device_Inventory_Device_Identity_Service
{
	const TYPE = 'system_uuid_v2';

	public function primary_identity()
	{
		return array(
			'type' => self::TYPE,
			'value' => 'system-v2-fixture',
			'confidence' => 100,
			'source' => 'server_recomputed',
		);
	}

	public function identities()
	{
		return array($this->primary_identity());
	}

}

class Npcink_Missing_Device_Identity_Service extends Npcink_Device_Inventory_Device_Identity_Service
{
	public function identities()
	{
		return array();
	}

	public function primary_identity()
	{
		return array('type' => '', 'value' => '', 'reason' => 'fixture_missing');
	}
}

class Npcink_Multiple_Device_Identity_Service extends Npcink_Device_Inventory_Device_Identity_Service
{
	public function identities()
	{
		return array(
			$this->primary_identity(),
			array('type' => 'pci_permanent_mac_v2', 'value' => 'pci-v2-fixture', 'confidence' => 80, 'source' => 'server_recomputed'),
		);
	}
}

class Npcink_Repeated_Board_Identity_Service extends Npcink_Device_Inventory_Device_Identity_Service
{
	public function identities()
	{
		return array(
			$this->primary_identity(),
			array('type' => 'baseboard_serial_v2', 'value' => 'board-v2-fixture', 'confidence' => 100, 'source' => 'server_recomputed'),
		);
	}
}

class Npcink_Ingest_Transaction_Fake_Wpdb
{
	public $commands = array();
	public $on_start;

	public function query($command)
	{
		$this->commands[] = $command;
		if ($command === 'START TRANSACTION' && $this->on_start) { ($this->on_start)(); }
		return 1;
	}
}

function npcink_ingest_asset_row($id, $uuid)
{
	return array(
		'id' => intval($id),
		'uuid' => $uuid,
		'asset_type' => 'computer',
		'asset_number' => 'A' . $id,
		'name' => 'Fixture asset',
		'owner_name' => '',
		'department' => '未分配',
		'status' => 'active',
		'category' => 'computer',
		'purchase_price' => 0,
		'residual_value' => 0,
		'financial_residual_value' => 0,
		'metadata_json' => '{}',
		'latest_observation_id' => null,
		'latest_observed_at' => null,
		'created_at' => '2026-07-15 12:00:00',
		'updated_at' => '2026-07-15 12:00:00',
	);
}

function npcink_ingest_claim($status, $owner_asset_id)
{
	return array(
		'status' => $status,
		'ownerAssetId' => $owner_asset_id === null ? null : intval($owner_asset_id),
		'identityType' => 'system_uuid_v2',
		'identityValue' => 'system-v2-fixture',
	);
}

function npcink_ingest_assert($condition, $message)
{
	if (!$condition) {
		fwrite(STDERR, "Observation ingest fixture failed: {$message}\n");
		exit(1);
	}
}

function npcink_ingest_payload()
{
	return array('observation' => array(
		'_npcink_device' => array(
			'schema_version' => 5,
			'observation_id' => 'cdb0d10b-858d-49aa-a8d4-bcb29f0cdd0e',
			'collector' => array('name' => 'fixture', 'collected_at' => '2026-07-15T12:00:00Z'),
		),
		'asset' => array(
			'summary' => array('device_model' => 'Fixture PC'),
			'hardware' => array(),
			'upload' => array('reported_user' => ''),
		),
	));
}

require_once __DIR__ . '/../includes/v3/services/class-npcink-device-inventory-observation-ingest-service.php';

$wpdb = new Npcink_Ingest_Transaction_Fake_Wpdb();
$assets = new Npcink_Device_Inventory_Asset_Repository(array(11 => npcink_ingest_asset_row(11, 'existing-asset')));
$identities = new Npcink_Device_Inventory_Identity_Repository();
$identities->claim_batches = array(
	array(npcink_ingest_claim(Npcink_Device_Inventory_Identity_Repository::CLAIM_CONFLICT, 11)),
	array(npcink_ingest_claim(Npcink_Device_Inventory_Identity_Repository::CLAIM_OWNED, 11)),
);
$observations = new Npcink_Device_Inventory_Observation_Repository();
$events = new Npcink_Device_Inventory_Event_Service();
$service = new Npcink_Device_Inventory_Observation_Ingest_Service(
	$assets,
	$identities,
	$observations,
	$events,
	new Npcink_Device_Inventory_Device_Identity_Service()
);
$result = $service->ingest(npcink_ingest_payload());
npcink_ingest_assert(is_array($result), 'a concurrent claim must recover successfully');
npcink_ingest_assert($result['data']['mode'] === 'matched_after_concurrent_claim', 'a concurrent first upload must resolve to the identity owner');
npcink_ingest_assert($identities->claimed_asset_ids === array(99, 11), 'the duplicate asset claim must roll back and retry against the winner');
npcink_ingest_assert(count($identities->claimed_identities[0]) === 1, 'an upload must claim exactly one server-derived identity');
npcink_ingest_assert($identities->claimed_identities[0][0]['source'] === 'server_recomputed', 'client-declared identities must not be persisted');
npcink_ingest_assert($observations->created_asset_ids === array(11), 'the observation must only be stored on the winning asset');
npcink_ingest_assert($wpdb->commands === array('START TRANSACTION', 'ROLLBACK', 'START TRANSACTION', 'COMMIT'), 'the losing asset write set must be rolled back before retry');
npcink_ingest_assert($assets->cache_invalidations === 2 && $observations->cache_invalidations === 2 && $identities->cache_invalidations === 2 && $events->cache_invalidations === 2, 'both rollback and commit must invalidate all transactional caches');

$wpdb = new Npcink_Ingest_Transaction_Fake_Wpdb();
$assets = new Npcink_Device_Inventory_Asset_Repository(array());
$identities = new Npcink_Device_Inventory_Identity_Repository();
$observations = new Npcink_Device_Inventory_Observation_Repository();
$events = new Npcink_Device_Inventory_Event_Service();
$events->fail_type = 'observation_received';
$service = new Npcink_Device_Inventory_Observation_Ingest_Service(
	$assets,
	$identities,
	$observations,
	$events,
	new Npcink_Device_Inventory_Device_Identity_Service()
);
$result = $service->ingest(npcink_ingest_payload());
npcink_ingest_assert($result instanceof WP_Error && $result->code === 'event_create_failed', 'audit failures must fail the ingest');
npcink_ingest_assert($wpdb->commands === array('START TRANSACTION', 'ROLLBACK'), 'audit failures must roll back every ingest write');
npcink_ingest_assert($assets->cache_invalidations === 1 && $observations->cache_invalidations === 1, 'failed ingests must invalidate transactional cache entries');

$wpdb = new Npcink_Ingest_Transaction_Fake_Wpdb();
$service = new Npcink_Device_Inventory_Observation_Ingest_Service(
	new Npcink_Device_Inventory_Asset_Repository(array()),
	new Npcink_Device_Inventory_Identity_Repository(),
	new Npcink_Device_Inventory_Observation_Repository(),
	new Npcink_Device_Inventory_Event_Service(),
	new Npcink_Missing_Device_Identity_Service()
);
$result = $service->ingest(npcink_ingest_payload());
npcink_ingest_assert($result instanceof WP_Error && $result->code === 'missing_identity', 'uploads without a server-computable identity must return 422 missing_identity');
npcink_ingest_assert($wpdb->commands === array(), 'missing identities must fail before starting a transaction');

$wpdb = new Npcink_Ingest_Transaction_Fake_Wpdb();
$archived_asset = npcink_ingest_asset_row(11, 'archived-owner');
$archived_asset['status'] = 'deleted';
$assets = new Npcink_Device_Inventory_Asset_Repository(array(11 => $archived_asset));
$identities = new Npcink_Device_Inventory_Identity_Repository();
$identities->matched_asset_id = 11;
$observations = new Npcink_Device_Inventory_Observation_Repository();
$service = new Npcink_Device_Inventory_Observation_Ingest_Service(
	$assets,
	$identities,
	$observations,
	new Npcink_Device_Inventory_Event_Service(),
	new Npcink_Device_Inventory_Device_Identity_Service()
);
$result = $service->ingest(npcink_ingest_payload());
npcink_ingest_assert($result instanceof WP_Error && $result->code === 'asset_archived', 'archived assets must reject new observations');
npcink_ingest_assert($wpdb->commands === array(), 'archived assets must reject uploads before starting a transaction');
npcink_ingest_assert($observations->created_asset_ids === array(), 'archived assets must not store new observations');

$wpdb = new Npcink_Ingest_Transaction_Fake_Wpdb();
$assets = new Npcink_Device_Inventory_Asset_Repository(
	array(
		11 => npcink_ingest_asset_row(11, 'system-owner'),
		22 => npcink_ingest_asset_row(22, 'board-owner'),
	)
);
$identities = new Npcink_Device_Inventory_Identity_Repository();
$identities->matched_asset_ids = array(
	'system_uuid_v2:system-v2-fixture' => 11,
	'pci_permanent_mac_v2:pci-v2-fixture' => 22,
);
$service = new Npcink_Device_Inventory_Observation_Ingest_Service(
	$assets,
	$identities,
	new Npcink_Device_Inventory_Observation_Repository(),
	new Npcink_Device_Inventory_Event_Service(),
	new Npcink_Multiple_Device_Identity_Service()
);
$result = $service->ingest(npcink_ingest_payload());
npcink_ingest_assert($result instanceof WP_Error && $result->code === 'identity_evidence_conflict', 'conflicting strong identities must fail closed');
npcink_ingest_assert($wpdb->commands === array(), 'identity evidence conflicts must fail before starting a transaction');

$wpdb = new Npcink_Ingest_Transaction_Fake_Wpdb();
$assets = new Npcink_Device_Inventory_Asset_Repository(
	array(
		11 => npcink_ingest_asset_row(11, 'system-owner'),
		22 => npcink_ingest_asset_row(22, 'board-owner'),
	)
);
$identities = new Npcink_Device_Inventory_Identity_Repository();
$identities->matched_asset_ids = array(
	'system_uuid_v2:system-v2-fixture' => 11,
	'baseboard_serial_v2:board-v2-fixture' => 22,
);
$service = new Npcink_Device_Inventory_Observation_Ingest_Service(
	$assets,
	$identities,
	new Npcink_Device_Inventory_Observation_Repository(),
	new Npcink_Device_Inventory_Event_Service(),
	new Npcink_Repeated_Board_Identity_Service()
);
$result = $service->ingest(npcink_ingest_payload());
npcink_ingest_assert(is_array($result) && $result['data']['mode'] === 'matched', 'a repeated board serial must not override a stronger identity owner');
npcink_ingest_assert($identities->claimed_asset_ids === array(11), 'a repeated board serial must not be claimed by the stronger identity owner');
npcink_ingest_assert(count($identities->claimed_identities[0]) === 1, 'a conflicting board serial must be skipped when a stronger identity is present');

$wpdb = new Npcink_Ingest_Transaction_Fake_Wpdb();
$assets = new Npcink_Device_Inventory_Asset_Repository(array(11 => npcink_ingest_asset_row(11, 'archive-race')));
$wpdb->on_start = function () use ($assets) { $assets->assets[11]['status'] = 'deleted'; };
$identities = new Npcink_Device_Inventory_Identity_Repository();
$identities->matched_asset_id = 11;
$observations = new Npcink_Device_Inventory_Observation_Repository();
$service = new Npcink_Device_Inventory_Observation_Ingest_Service($assets, $identities, $observations, new Npcink_Device_Inventory_Event_Service(), new Npcink_Device_Inventory_Device_Identity_Service());
$result = $service->ingest(npcink_ingest_payload());
npcink_ingest_assert(is_wp_error($result) && $result->code === 'asset_archived', 'an archive committed after initial lookup must prevent upload');
npcink_ingest_assert($observations->created_asset_ids === array(), 'an archived asset must not receive an observation');
npcink_ingest_assert($wpdb->commands === array('START TRANSACTION', 'ROLLBACK'), 'archive race must roll back');

$wpdb = new Npcink_Ingest_Transaction_Fake_Wpdb();
$observations->fail_create = true;
$assets->assets[11]['status'] = 'active';
$result = $service->ingest(npcink_ingest_payload());
npcink_ingest_assert(is_wp_error($result) && $result->code === 'observation_create_failed', 'a repository write failure must fail the upload');
npcink_ingest_assert($wpdb->commands === array('START TRANSACTION', 'ROLLBACK'), 'a failed latest pointer must never commit partial data');

foreach (array('2099-01-01T00:00:00Z', '2026-02-30T12:00:00Z', 'tomorrow', 'not-a-date') as $invalid_time) {
	$wpdb = new Npcink_Ingest_Transaction_Fake_Wpdb();
	$payload = npcink_ingest_payload();
	$payload['observation']['_npcink_device']['collector']['collected_at'] = $invalid_time;
	$result = $service->ingest($payload);
	npcink_ingest_assert(is_wp_error($result) && $result->code === 'invalid_observation_time', 'invalid or future collection time must fail');
	npcink_ingest_assert($wpdb->commands === array(), 'invalid time must be rejected before any write');
}
$wpdb = new Npcink_Ingest_Transaction_Fake_Wpdb();
$assets = new Npcink_Device_Inventory_Asset_Repository(array(11 => npcink_ingest_asset_row(11, 'existing-asset')));
$identities = new Npcink_Device_Inventory_Identity_Repository();
$identities->matched_asset_id = 11;
$observations = new Npcink_Device_Inventory_Observation_Repository();
$events = new Npcink_Device_Inventory_Event_Service();
$service = new Npcink_Device_Inventory_Observation_Ingest_Service($assets, $identities, $observations, $events, new Npcink_Device_Inventory_Device_Identity_Service());
$payload = npcink_ingest_payload();
$first = $service->ingest($payload);
npcink_ingest_assert(!is_wp_error($first), 'current wrapped contract must be accepted');
$observations->receipt = $observations->last_created;
$event_count = count($events->events);
$payload['observation']['asset']['upload']['uploaded_at'] = '2026-10-27T12:00:00Z';
$retry = $service->ingest($payload);
npcink_ingest_assert($retry['data']['mode'] === 'duplicate' && $retry['data']['observation']['id'] === $first['data']['observation']['id'], 'retry must return the original receipt');
npcink_ingest_assert(count($observations->created_asset_ids) === 1 && count($events->events) === $event_count, 'retry must not insert another observation or event');
npcink_ingest_assert(!isset($retry['data']['observation']['hardware']) && !isset($retry['data']['identities']), 'upload receipt must not echo full hardware and identity payloads');
$payload['observation']['asset']['summary']['device_model'] = 'different facts';
$conflict = $service->ingest($payload);
npcink_ingest_assert(is_wp_error($conflict) && $conflict->code === 'observation_id_conflict', 'same ID with different facts must be rejected');
$unsupported = npcink_ingest_payload();
$unsupported['observation']['_npcink_device']['schema_version'] = 999;
npcink_ingest_assert($service->ingest($unsupported)->code === 'unsupported_observation_schema', 'unsupported versions must be rejected');
npcink_ingest_assert($service->ingest(npcink_ingest_payload()['observation'])->code === 'invalid_payload', 'unwrapped legacy payloads must be rejected');
$bad_type = npcink_ingest_payload();
$bad_type['observation']['asset']['summary']['memory_bytes'] = '16 GB';
npcink_ingest_assert($service->ingest($bad_type)->code === 'invalid_observation_field', 'summary units and field types must be checked');
echo "Observation ingest fixture checks passed.\n";
