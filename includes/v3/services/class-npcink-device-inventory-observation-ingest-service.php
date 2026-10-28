<?php

if (!defined('ABSPATH')) {
	exit;
}

class Npcink_Device_Inventory_Observation_Ingest_Service
{
	const MAX_CLOCK_SKEW_SECONDS = 300;
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
		if (!is_array($payload) || count($payload) !== 1 || !isset($payload['observation']) || !is_array($payload['observation'])) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_payload', 'Request body must contain exactly one observation object.', 422);
		}

		$observation_payload = $payload['observation'];
		$observation_input = $this->build_observation_input($observation_payload);
		if (is_wp_error($observation_input)) {
			return $observation_input;
		}
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
		$mode = 'matched';
		$asset = $asset_id ? $this->assets->find_by_id($asset_id) : null;
		if ($asset && isset($asset['status']) && $asset['status'] === 'deleted') {
			return Npcink_Device_Inventory_V3_Response::error(
				'asset_archived',
				'Archived assets cannot receive device observations. Restore the asset before uploading again.',
				409
			);
		}

		if (!$this->begin_transaction()) {
			return Npcink_Device_Inventory_V3_Response::error('transaction_start_failed', 'Failed to start observation transaction.', 500);
		}

		$created = false;
		if ($asset) {
			$asset = $this->lock_upload_asset($asset);
			if (is_wp_error($asset)) {
				$this->rollback_transaction();
				return $asset;
			}
		}
		if (!$asset) {
			$asset = $this->assets->create($this->build_asset_input($observation_payload));
			if (!$asset) {
				return $this->rollback_error('asset_create_failed', 'Failed to create asset.');
			}
			$created = true;
			$mode = 'created';
		}

		$claim_results = $this->identities->claim_many(
			intval($asset['id']),
			$this->claimable_identities(intval($asset['id']), $identities)
		);
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
			$asset = $this->lock_upload_asset($asset);
			if (is_wp_error($asset)) {
				$this->rollback_transaction();
				return $asset;
			}
			$claim_results = $this->identities->claim_many(
				intval($asset['id']),
				$this->claimable_identities(intval($asset['id']), $identities)
			);
			$claim_error = $this->claim_error($claim_results);
			if ($claim_error) {
				$this->rollback_transaction();
				return $claim_error;
			}
			if (!empty($this->claim_conflict_owner_ids($claim_results))) {
				return $this->rollback_error('identity_claim_conflict', 'Authoritative identity could not be claimed.', 409);
			}
		}

		$previous = $this->observations->find_by_upload_id($observation_input['observation_uuid']);
		if (is_wp_error($previous)) {
			$this->rollback_transaction();
			return $previous;
		}
		if ($previous) {
			if (intval($previous['asset_id']) !== intval($asset['id']) || !hash_equals((string) $previous['payload_hash'], $observation_input['payload_hash'])) {
				$this->rollback_transaction();
				return Npcink_Device_Inventory_V3_Response::error('observation_id_conflict', 'Observation ID already belongs to different submitted facts.', 409);
			}
			if (!$this->commit_transaction()) {
				return $this->rollback_error('transaction_commit_failed', 'Failed to commit observation transaction.');
			}
			return $this->receipt($asset, $previous, 'duplicate');
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

		$observation = $this->observations->create(intval($asset['id']), $observation_input);
		if (!$observation) {
			// Roll back first: a failed pointer update must never find its own uncommitted row as a receipt.
			$this->rollback_transaction();
			$competing = $this->observations->find_by_upload_id($observation_input['observation_uuid']);
			if (is_wp_error($competing)) {
				return $competing;
			}
			if ($competing) {
				if (intval($competing['asset_id']) === intval($asset['id']) && hash_equals((string) $competing['payload_hash'], $observation_input['payload_hash'])) {
					return $this->receipt($asset, $competing, 'duplicate');
				}
				return Npcink_Device_Inventory_V3_Response::error('observation_id_conflict', 'Observation ID is already in use.', 409);
			}
			return Npcink_Device_Inventory_V3_Response::error('observation_create_failed', 'Failed to store observation.', 500);
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

		return $this->receipt($asset, $observation, $mode);
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

	private function lock_upload_asset($asset)
	{
		$asset = $this->assets->find_by_id_for_update(intval($asset['id']));
		if (!$asset) {
			return Npcink_Device_Inventory_V3_Response::error('identity_owner_unavailable', 'Identity owner could not be locked.', 409);
		}
		if ($asset['status'] === 'deleted') {
			return Npcink_Device_Inventory_V3_Response::error('asset_archived', 'Archived assets cannot receive device observations.', 409);
		}
		return $asset;
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
		if ($wpdb->query('COMMIT') === false) {
			return false;
		}
		$this->invalidate_transaction_caches();
		return true;
	}

	private function rollback_transaction()
	{
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Roll back every partial ingest write on failure.
		$wpdb->query('ROLLBACK');
		$this->invalidate_transaction_caches();
	}

	private function invalidate_transaction_caches()
	{
		// A separate connection may have cached old committed state during the write.
		$this->assets->invalidate_cache();
		$this->identities->invalidate_cache();
		$this->observations->invalidate_cache();
		$this->events->invalidate_cache();
	}

	private function rollback_error($code, $message, $status = 500)
	{
		$this->rollback_transaction();
		return Npcink_Device_Inventory_V3_Response::error($code, $message, $status);
	}

	private function matching_asset_ids($identities)
	{
		$strong_owner_ids = array();
		$weak_owner_ids = array();
		foreach ($identities as $identity) {
			$asset_id = $this->identities->find_asset_id_by_identity($identity['type'], $identity['value']);
			if ($asset_id) {
				if ($this->is_weak_identity($identity)) {
					$weak_owner_ids[] = intval($asset_id);
				} else {
					$strong_owner_ids[] = intval($asset_id);
				}
			}
		}

		// A repeated board serial is useful supporting evidence, but it cannot
		// override a stronger system UUID or permanent PCI MAC owner.
		if (!empty($strong_owner_ids)) {
			return array_values(array_unique($strong_owner_ids));
		}
		return array_values(array_unique($weak_owner_ids));
	}

	private function claimable_identities($asset_id, $identities)
	{
		$has_strong_identity = false;
		foreach ($identities as $identity) {
			if (!$this->is_weak_identity($identity)) {
				$has_strong_identity = true;
				break;
			}
		}
		if (!$has_strong_identity) {
			return $identities;
		}

		$claimable = array();
		foreach ($identities as $identity) {
			if (!$this->is_weak_identity($identity)) {
				$claimable[] = $identity;
				continue;
			}
			$owner_id = $this->identities->find_asset_id_by_identity($identity['type'], $identity['value']);
			if (!$owner_id || intval($owner_id) === intval($asset_id)) {
				$claimable[] = $identity;
			}
		}
		return $claimable;
	}

	private function is_weak_identity($identity)
	{
		return isset($identity['type']) && $identity['type'] === 'baseboard_serial_v2';
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
			'category' => '台式电脑',
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
		foreach (array('_npcink_device', 'asset') as $key) {
			if (!isset($payload[$key]) || !is_array($payload[$key])) {
				return $this->invalid_field('/observation/' . $key);
			}
		}
		$asset = $payload['asset'];
		$meta = $payload['_npcink_device'];
		if (!isset($meta['schema_version']) || $meta['schema_version'] !== 5) {
			return Npcink_Device_Inventory_V3_Response::error('unsupported_observation_schema', 'Only observation schema 5 is supported.', 422);
		}
		if (!isset($meta['observation_id']) || !is_string($meta['observation_id']) || !preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/D', $meta['observation_id'])) {
			return $this->invalid_field('/observation/_npcink_device/observation_id');
		}
		$collector = isset($meta['collector']) && is_array($meta['collector']) ? $meta['collector'] : array();
		foreach (array('name', 'collected_at') as $key) {
			if (!isset($collector[$key]) || !is_string($collector[$key]) || $collector[$key] === '') {
				return $this->invalid_field('/observation/_npcink_device/collector/' . $key);
			}
		}
		foreach (array('hardware', 'summary') as $key) {
			if (!isset($asset[$key]) || !is_array($asset[$key]) || ($asset[$key] && array_keys($asset[$key]) === range(0, count($asset[$key]) - 1))) {
				return $this->invalid_field('/observation/asset/' . $key);
			}
		}
		foreach (array('device_model', 'hostname', 'os', 'platform', 'cpu', 'graphics', 'primary_ip') as $key) {
			if (array_key_exists($key, $asset['summary']) && !is_string($asset['summary'][$key])) {
				return $this->invalid_field('/observation/asset/summary/' . $key);
			}
		}
		foreach (array('memory_bytes', 'disk_bytes') as $key) {
			if (isset($asset['summary'][$key]) && (!is_int($asset['summary'][$key]) || $asset['summary'][$key] < 0)) {
				return $this->invalid_field('/observation/asset/summary/' . $key);
			}
		}
		if (isset($asset['upload']) && !is_array($asset['upload'])) {
			return $this->invalid_field('/observation/asset/upload');
		}
		foreach (array('note', 'reported_user', 'uploaded_at') as $key) {
			if (isset($asset['upload'][$key]) && !is_string($asset['upload'][$key])) {
				return $this->invalid_field('/observation/asset/upload/' . $key);
			}
		}
		$observed_at = $this->normalize_datetime($collector['collected_at']);
		if (is_wp_error($observed_at)) {
			return $observed_at;
		}

		$hash_payload = $payload;
		unset($hash_payload['asset']['upload']['uploaded_at']);
		return array(
			'source' => sanitize_key($collector['name']),
			'schema_version' => 5,
			'observation_uuid' => $meta['observation_id'],
			'payload_hash' => hash('sha256', wp_json_encode($this->canonical_value($hash_payload))),
			'observed_at' => $observed_at,
			'summary' => $asset['summary'],
			'hardware' => $asset['hardware'],
			// The complete source facts already live in hardware.platformData; do not store hardware twice.
			'raw' => array('_npcink_device' => $meta, 'upload' => isset($asset['upload']) ? $asset['upload'] : array(), 'source' => isset($payload['raw']) ? $payload['raw'] : array()),
		);
	}

	private function invalid_field($path)
	{
		return Npcink_Device_Inventory_V3_Response::error('invalid_observation_field', 'Observation field has an invalid type or value.', 422, array('path' => $path));
	}

	private function canonical_value($value)
	{
		if (is_array($value)) {
			if ($value && array_keys($value) !== range(0, count($value) - 1)) {
				ksort($value, SORT_STRING);
			}
			foreach ($value as $key => $child) {
				$value[$key] = $this->canonical_value($child);
			}
		}
		return $value;
	}

	private function receipt($asset, $observation, $mode)
	{
		return array('data' => array(
			'mode' => $mode,
			'asset' => array('id' => intval($asset['id']), 'uuid' => (string) $asset['uuid'], 'assetNumber' => (string) $asset['asset_number'], 'name' => (string) $asset['name']),
			'observation' => array('id' => intval($observation['id']), 'observationId' => (string) $observation['observation_uuid'], 'observedAt' => $this->format_utc_datetime($observation['observed_at']), 'receivedAt' => (string) $observation['received_at']),
		));
	}

	private function normalize_datetime($value)
	{
		if (preg_match('/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/', $value)) {
			try {
				$date = new DateTimeImmutable($value, new DateTimeZone('UTC'));
				$errors = DateTimeImmutable::getLastErrors();
				if ((!$errors || (!$errors['warning_count'] && !$errors['error_count'])) && $date->getTimestamp() <= time() + self::MAX_CLOCK_SKEW_SECONDS && intval($date->format('Y')) >= 1000) {
					return gmdate('Y-m-d H:i:s', $date->getTimestamp());
				}
			} catch (Exception $exception) {
				// Invalid dates fail closed below; missing dates are filled before validation.
			}
		}
		return Npcink_Device_Inventory_V3_Response::error('invalid_observation_time', 'Collection time is invalid or more than five minutes in the future.', 422);
	}

	private function format_utc_datetime($value)
	{
		$value = trim((string) $value);
		if ($value === '') {
			return '';
		}
		return str_replace(' ', 'T', $value) . 'Z';
	}

}
