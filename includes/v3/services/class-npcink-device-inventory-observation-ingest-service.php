<?php

if (!defined('ABSPATH')) {
	exit;
}

class Npcink_Device_Inventory_Observation_Ingest_Service
{
	private $assets;
	private $identities;
	private $observations;
	private $events;
	private $device_identity;

	public function __construct(
		Npcink_Device_Inventory_Asset_Repository $assets,
		Npcink_Device_Inventory_Identity_Repository $identities,
		Npcink_Device_Inventory_Observation_Repository $observations,
		Npcink_Device_Inventory_Event_Service $events,
		Npcink_Device_Inventory_Device_Identity_Service $device_identity
	) {
		$this->assets = $assets;
		$this->identities = $identities;
		$this->observations = $observations;
		$this->events = $events;
		$this->device_identity = $device_identity;
	}

	public function ingest($payload)
	{
		if (!is_array($payload)) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_payload', 'Request body must be a JSON object.', 400);
		}

		$observation_payload = isset($payload['observation']) && is_array($payload['observation'])
			? $payload['observation']
			: $payload;
		$identities = $this->device_identity->identities($observation_payload);
		$primary_identity = !empty($identities) ? $identities[0] : $this->device_identity->primary_identity($observation_payload);
		if (empty($identities) || empty($primary_identity['type']) || empty($primary_identity['value'])) {
			return Npcink_Device_Inventory_V3_Response::error(
				'missing_identity',
				'Observation cannot produce a device identity.',
				422,
				array('reason' => isset($primary_identity['reason']) ? $primary_identity['reason'] : 'insufficient_hardware_facts')
			);
		}
		$owner_ids = $this->matching_asset_ids($identities);
		if (count($owner_ids) > 1) {
			return Npcink_Device_Inventory_V3_Response::error('identity_evidence_conflict', 'Hardware identity signals belong to different assets.', 409);
		}
		$asset_id = !empty($owner_ids) ? $owner_ids[0] : null;
		$matched_by_legacy_identity = false;
		if (!$asset_id) {
			$legacy_identity = $this->device_identity->legacy_primary_identity($observation_payload);
			if (!empty($legacy_identity['type']) && !empty($legacy_identity['value'])) {
				$asset_id = $this->identities->find_asset_id_by_identity($legacy_identity['type'], $legacy_identity['value']);
				$matched_by_legacy_identity = !empty($asset_id);
			}
		}
		$mode = 'matched';
		$asset = $asset_id ? $this->assets->find_by_id($asset_id) : null;
		if ($asset && isset($asset['status']) && $asset['status'] === 'deleted') {
			return Npcink_Device_Inventory_V3_Response::error(
				'asset_archived',
				'Archived assets cannot receive device observations. Restore the asset before uploading again.',
				409
			);
		}
		if ($matched_by_legacy_identity && $asset && $this->legacy_migration_conflicts($asset, $identities)) {
			return Npcink_Device_Inventory_V3_Response::error(
				'legacy_identity_migration_conflict',
				'Legacy identity matched an asset whose latest hardware evidence conflicts with this upload.',
				409
			);
		}

		if (!$this->begin_transaction()) {
			return Npcink_Device_Inventory_V3_Response::error('transaction_start_failed', 'Failed to start observation transaction.', 500);
		}

		$created = false;
		if (!$asset) {
			$asset = $this->assets->create($this->build_asset_input($observation_payload));
			if (!$asset) {
				return $this->rollback_error('asset_create_failed', 'Failed to create asset.');
			}
			$created = true;
			$mode = 'created';
		}

		$claim_results = $this->identities->claim_many(intval($asset['id']), $identities);
		$claim_error = $this->claim_error($claim_results);
		if ($claim_error) {
			$this->rollback_transaction();
			return $claim_error;
		}

		$conflict_owner_ids = $this->claim_conflict_owner_ids($claim_results);
		if (!empty($conflict_owner_ids)) {
			$this->rollback_transaction();
			if (count($conflict_owner_ids) !== 1) {
				return Npcink_Device_Inventory_V3_Response::error('identity_evidence_conflict', 'Hardware identity signals belong to different assets.', 409);
			}
			$asset = $this->assets->find_by_id($conflict_owner_ids[0]);
			if ($asset && isset($asset['status']) && $asset['status'] === 'deleted') {
				return Npcink_Device_Inventory_V3_Response::error(
					'asset_archived',
					'Archived assets cannot receive device observations. Restore the asset before uploading again.',
					409
				);
			}
			if (!$asset || !$this->begin_transaction()) {
				return Npcink_Device_Inventory_V3_Response::error('identity_owner_unavailable', 'Identity owner could not be loaded.', 409);
			}
			$created = false;
			$mode = 'matched_after_concurrent_claim';
			$claim_results = $this->identities->claim_many(intval($asset['id']), $identities);
			$claim_error = $this->claim_error($claim_results);
			if ($claim_error) {
				$this->rollback_transaction();
				return $claim_error;
			}
			if (!empty($this->claim_conflict_owner_ids($claim_results))) {
				return $this->rollback_error('identity_claim_conflict', 'Authoritative identity could not be claimed.', 409);
			}
		}

		if ($created && !$this->events->record(intval($asset['id']), 'upload', 'created', 'Asset created from first observation.', array('identity' => $primary_identity))) {
			return $this->rollback_error('event_create_failed', 'Failed to record asset creation.');
		}

		$uploaded_owner = $this->uploaded_owner_name($observation_payload);
		if (!$created && $uploaded_owner !== '' && trim((string) $asset['owner_name']) === '') {
			$updated_asset = $this->assets->update($asset['uuid'], array('owner_name' => $uploaded_owner));
			if (!$updated_asset) {
				return $this->rollback_error('asset_update_failed', 'Failed to update asset owner.');
			}
			if (!$this->events->record(
				intval($asset['id']),
				'upload',
				'owner_filled',
				'Asset owner filled from upload note.',
				array('old_owner_name' => (string) $asset['owner_name'], 'new_owner_name' => $uploaded_owner)
			)) {
				return $this->rollback_error('event_create_failed', 'Failed to record asset owner update.');
			}
			$asset = $updated_asset;
		}

		$observation = $this->observations->create(intval($asset['id']), $this->build_observation_input($observation_payload));
		if (!$observation) {
			return $this->rollback_error('observation_create_failed', 'Failed to store observation.');
		}

		if (!$this->events->record(
			intval($asset['id']),
			'upload',
			'observation_received',
			'Device observation received.',
			array('observation_id' => intval($observation['id']), 'mode' => $mode)
		)) {
			return $this->rollback_error('event_create_failed', 'Failed to record observation event.');
		}

		if (!$this->commit_transaction()) {
			return $this->rollback_error('transaction_commit_failed', 'Failed to commit observation transaction.');
		}

		return array(
			'data' => array(
				'mode' => $mode,
				'asset' => $this->format_asset($asset),
				'observation' => $this->format_observation($observation),
				'identities' => array_map(array($this, 'format_identity'), $this->identities->list_for_asset(intval($asset['id']))),
			),
		);
	}

	private function claim_error($claim_results)
	{
		foreach ($claim_results as $claim) {
			if ($claim['status'] === Npcink_Device_Inventory_Identity_Repository::CLAIM_INVALID) {
				return Npcink_Device_Inventory_V3_Response::error('invalid_identity', 'Observation contains an invalid identity.', 422);
			}
			if ($claim['status'] === Npcink_Device_Inventory_Identity_Repository::CLAIM_ERROR) {
				return Npcink_Device_Inventory_V3_Response::error('identity_claim_failed', 'Failed to claim observation identity.', 500);
			}
		}
		return null;
	}

	private function begin_transaction()
	{
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- The ingest write set must be committed atomically.
		return $wpdb->query('START TRANSACTION') !== false;
	}

	private function commit_transaction()
	{
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- The ingest write set must be committed atomically.
		return $wpdb->query('COMMIT') !== false;
	}

	private function rollback_transaction()
	{
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Roll back every partial ingest write on failure.
		$wpdb->query('ROLLBACK');
		$this->assets->invalidate_cache();
		$this->observations->invalidate_cache();
	}

	private function rollback_error($code, $message, $status = 500)
	{
		$this->rollback_transaction();
		return Npcink_Device_Inventory_V3_Response::error($code, $message, $status);
	}

	private function matching_asset_ids($identities)
	{
		$owner_ids = array();
		foreach ($identities as $identity) {
			$asset_id = $this->identities->find_asset_id_by_identity($identity['type'], $identity['value']);
			if ($asset_id) {
				$owner_ids[] = intval($asset_id);
			}
		}
		return array_values(array_unique($owner_ids));
	}

	private function legacy_migration_conflicts($asset, $incoming_identities)
	{
		$latest_observation_id = isset($asset['latest_observation_id']) ? intval($asset['latest_observation_id']) : 0;
		if ($latest_observation_id <= 0) {
			return false;
		}

		$observation = $this->observations->find_by_id($latest_observation_id);
		if (!$observation || empty($observation['hardware_json'])) {
			return false;
		}
		$hardware = json_decode((string) $observation['hardware_json'], true);
		if (!is_array($hardware) || empty($hardware)) {
			return false;
		}

		$existing_identities = $this->device_identity->identities(array('asset' => array('hardware' => $hardware)));
		if (empty($existing_identities)) {
			return false;
		}

		$existing_keys = array();
		foreach ($existing_identities as $identity) {
			if (!empty($identity['type']) && !empty($identity['value'])) {
				$existing_keys[$identity['type'] . "\0" . $identity['value']] = true;
			}
		}
		foreach ($incoming_identities as $identity) {
			$key = isset($identity['type'], $identity['value']) ? $identity['type'] . "\0" . $identity['value'] : '';
			if ($key !== '' && isset($existing_keys[$key])) {
				return false;
			}
		}
		return true;
	}

	private function claim_conflict_owner_ids($claim_results)
	{
		$owner_ids = array();
		foreach ($claim_results as $claim) {
			if ($claim['status'] === Npcink_Device_Inventory_Identity_Repository::CLAIM_CONFLICT && !empty($claim['ownerAssetId'])) {
				$owner_ids[] = intval($claim['ownerAssetId']);
			}
		}
		return array_values(array_unique($owner_ids));
	}

	private function build_asset_input($payload)
	{
		$asset = isset($payload['asset']) && is_array($payload['asset']) ? $payload['asset'] : array();
		$summary = isset($asset['summary']) && is_array($asset['summary']) ? $asset['summary'] : array();

		$name = !empty($summary['device_model']) ? $summary['device_model'] : 'Unnamed asset';
		$owner = $this->uploaded_owner_name($payload);

		return array(
			'asset_type' => 'computer',
			'asset_number' => '',
			'name' => $name,
			'owner_name' => $owner,
			'department' => '',
			'status' => 'active',
			'category' => 'computer',
			'purchase_price' => 0,
			'residual_value' => 0,
			'financial_residual_value' => 0,
			'metadata' => array(
				'summary' => $summary,
			),
		);
	}

	private function uploaded_owner_name($payload)
	{
		$asset = isset($payload['asset']) && is_array($payload['asset']) ? $payload['asset'] : array();
		$upload = isset($asset['upload']) && is_array($asset['upload']) ? $asset['upload'] : array();
		return !empty($upload['reported_user']) ? sanitize_text_field($upload['reported_user']) : '';
	}

	private function build_observation_input($payload)
	{
		$asset = isset($payload['asset']) && is_array($payload['asset']) ? $payload['asset'] : array();
		$meta = isset($payload['_npcink_device']) && is_array($payload['_npcink_device']) ? $payload['_npcink_device'] : array();
		$collector = isset($meta['collector']) && is_array($meta['collector']) ? $meta['collector'] : array();
		$observed_at = !empty($collector['collected_at']) ? sanitize_text_field($collector['collected_at']) : current_time('mysql', true);

		return array(
			'source' => !empty($collector['name']) ? sanitize_key($collector['name']) : 'uploader',
			'schema_version' => !empty($meta['schema_version']) ? intval($meta['schema_version']) : 1,
			'observed_at' => $this->normalize_datetime($observed_at),
			'summary' => isset($asset['summary']) && is_array($asset['summary']) ? $asset['summary'] : array(),
			'hardware' => isset($asset['hardware']) && is_array($asset['hardware']) ? $asset['hardware'] : array(),
			'raw' => $payload,
		);
	}

	private function normalize_datetime($value)
	{
		$timestamp = strtotime($value);
		if (!$timestamp) {
			return current_time('mysql', true);
		}
		return gmdate('Y-m-d H:i:s', $timestamp);
	}

	private function format_utc_datetime($value)
	{
		$value = trim((string) $value);
		if ($value === '') {
			return '';
		}
		return str_replace(' ', 'T', $value) . 'Z';
	}

	private function format_asset($row)
	{
		return array(
			'id' => intval($row['id']),
			'uuid' => (string) $row['uuid'],
			'assetType' => (string) $row['asset_type'],
			'assetNumber' => (string) $row['asset_number'],
			'name' => (string) $row['name'],
			'ownerName' => (string) $row['owner_name'],
			'department' => (string) $row['department'],
			'status' => (string) $row['status'],
			'category' => (string) $row['category'],
			'purchasePrice' => floatval($row['purchase_price']),
			'secondHandMarketValue' => floatval($row['residual_value']),
			'financialResidualValue' => floatval(isset($row['financial_residual_value']) ? $row['financial_residual_value'] : 0),
			'residualValue' => floatval($row['residual_value']),
			'metadata' => $this->decode_json(isset($row['metadata_json']) ? $row['metadata_json'] : '', array()),
			'createdAt' => (string) $row['created_at'],
			'updatedAt' => (string) $row['updated_at'],
		);
	}

	private function format_identity($row)
	{
		return array(
			'id' => intval($row['id']),
			'assetId' => intval($row['asset_id']),
			'identityType' => (string) $row['identity_type'],
			'identityValue' => (string) $row['identity_value'],
			'confidence' => floatval($row['confidence']),
			'isPrimary' => intval($row['is_primary']) === 1,
			'source' => (string) $row['source'],
			'createdAt' => (string) $row['created_at'],
		);
	}

	private function format_observation($row)
	{
		return array(
			'id' => intval($row['id']),
			'assetId' => intval($row['asset_id']),
			'source' => (string) $row['source'],
			'schemaVersion' => intval($row['schema_version']),
			'observedAt' => $this->format_utc_datetime(isset($row['observed_at']) ? $row['observed_at'] : ''),
			'receivedAt' => (string) $row['received_at'],
			'summary' => $this->decode_json(isset($row['summary_json']) ? $row['summary_json'] : '', array()),
			'hardware' => $this->decode_json(isset($row['hardware_json']) ? $row['hardware_json'] : '', array()),
			'raw' => $this->decode_json(isset($row['raw_json']) ? $row['raw_json'] : '', array()),
		);
	}

	private function decode_json($value, $fallback)
	{
		if (!is_string($value) || $value === '') {
			return $fallback;
		}

		$decoded = json_decode($value, true);
		if (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded)) {
			return $fallback;
		}

		return $decoded;
	}
}
