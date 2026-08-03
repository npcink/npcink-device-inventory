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

function current_time()
{
	return '2026-07-15 12:00:00';
}

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
	public $created_asset_ids = array();
	public $cache_invalidations = 0;

	public function create($asset_id)
	{
		$this->created_asset_ids[] = intval($asset_id);
		return array(
			'id' => 501,
			'asset_id' => intval($asset_id),
			'source' => 'fixture',
			'schema_version' => 3,
			'observed_at' => '2026-07-15 12:00:00',
			'received_at' => '2026-07-15 12:00:01',
			'summary_json' => '{}',
			'hardware_json' => '{}',
			'raw_json' => '{}',
		);
	}

	public function invalidate_cache()
	{
		$this->cache_invalidations++;
	}
}

class Npcink_Device_Inventory_Event_Service
{
	public $events = array();
	public $fail_type = '';

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

	public function legacy_primary_identity()
	{
		return array('type' => '', 'value' => '');
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
			array('type' => 'baseboard_serial_v2', 'value' => 'board-v2-fixture', 'confidence' => 100, 'source' => 'server_recomputed'),
		);
	}
}

class Npcink_Legacy_Match_Device_Identity_Service extends Npcink_Device_Inventory_Device_Identity_Service
{
	public function legacy_primary_identity()
	{
		return array('type' => 'device_uuid_v1', 'value' => 'device-v1-existing');
	}
}

class Npcink_Ingest_Transaction_Fake_Wpdb
{
	public $commands = array();

	public function query($command)
	{
		$this->commands[] = $command;
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
		'metadata_json' => '{}',
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
	return array(
		'_npcink_device' => array(
			'schema_version' => 3,
			'collector' => array('name' => 'fixture', 'collected_at' => '2026-07-15T12:00:00Z'),
		),
		'asset' => array(
			'summary' => array('device_model' => 'Fixture PC'),
			'hardware' => array(),
			'upload' => array('reported_user' => ''),
		),
	);
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
npcink_ingest_assert($assets->cache_invalidations === 1 && $observations->cache_invalidations === 1, 'the losing transaction must invalidate rows read before rollback');

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
	new Npcink_Multiple_Device_Identity_Service()
);
$result = $service->ingest(npcink_ingest_payload());
npcink_ingest_assert($result instanceof WP_Error && $result->code === 'identity_evidence_conflict', 'conflicting strong identities must fail closed');
npcink_ingest_assert($wpdb->commands === array(), 'identity evidence conflicts must fail before starting a transaction');

$wpdb = new Npcink_Ingest_Transaction_Fake_Wpdb();
$assets = new Npcink_Device_Inventory_Asset_Repository(array(11 => npcink_ingest_asset_row(11, 'legacy-owner')));
$identities = new Npcink_Device_Inventory_Identity_Repository();
$identities->matched_asset_ids = array('device_uuid_v1:device-v1-existing' => 11);
$service = new Npcink_Device_Inventory_Observation_Ingest_Service(
	$assets,
	$identities,
	new Npcink_Device_Inventory_Observation_Repository(),
	new Npcink_Device_Inventory_Event_Service(),
	new Npcink_Legacy_Match_Device_Identity_Service()
);
$result = $service->ingest(npcink_ingest_payload());
npcink_ingest_assert(is_array($result) && $result['data']['mode'] === 'matched', 'a v2 upload must attach to an existing v1 asset during the transition');
npcink_ingest_assert($identities->claimed_asset_ids === array(11), 'the v2 identity must be backfilled onto the legacy asset');

echo "Observation ingest fixture checks passed.\n";
