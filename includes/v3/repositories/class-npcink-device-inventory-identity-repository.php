<?php

if (!defined('ABSPATH')) {
	exit;
}

class Npcink_Device_Inventory_Identity_Repository
{
	const CACHE_GROUP = 'npcink_device_inventory_identities';
	const CACHE_TTL = 60;
	const CLAIM_INSERTED = 'inserted';
	const CLAIM_OWNED = 'owned';
	const CLAIM_CONFLICT = 'conflict';
	const CLAIM_INVALID = 'invalid';
	const CLAIM_ERROR = 'error';
	const ALLOWED_TYPES = array('system_uuid_v2', 'baseboard_serial_v2', 'pci_permanent_mac_v2', 'device_uuid_v1', 'fallback_device_v1');

	public function find_asset_id_by_identities($identities)
	{
		global $wpdb;
		$identities_table = Npcink_Device_Inventory_V3_Tables::identities();
		if (empty($identities)) {
			return null;
		}

		foreach ($identities as $identity) {
			if (empty($identity['type']) || empty($identity['value'])) {
				continue;
			}
			$type = sanitize_key($identity['type']);
			$value = sanitize_text_field($identity['value']);
			$cache_key = $this->build_cache_key(
				'identity-asset',
				array(
					'type' => $type,
					'value' => $value,
					'version' => $this->get_list_cache_version(),
				)
			);
			$cached = wp_cache_get($cache_key, self::CACHE_GROUP);
			if ($cached !== false) {
				if ($cached) {
					return intval($cached);
				}
				continue;
			}

			// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery -- Plugin-owned identity table query is wrapped in the object cache.
			$asset_id = $wpdb->get_var(
				$wpdb->prepare(
					'SELECT asset_id FROM %i WHERE identity_type = %s AND identity_value = %s LIMIT 1',
					$identities_table,
					$type,
					$value
				)
			);
			// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery
			wp_cache_set($cache_key, $asset_id ? intval($asset_id) : 0, self::CACHE_GROUP, self::CACHE_TTL);
			if ($asset_id) {
				return intval($asset_id);
			}
		}

		return null;
	}

	public function find_asset_id_by_identity($type, $value)
	{
		return $this->find_asset_id_by_identities(
			array(
				array(
					'type' => $type,
					'value' => $value,
				),
			)
		);
	}

	public function list_for_asset($asset_id)
	{
		global $wpdb;
		$asset_id = intval($asset_id);
		$cache_key = $this->build_cache_key(
			'asset-list',
			array(
				'asset_id' => $asset_id,
				'version' => $this->get_list_cache_version(),
			)
		);
		$cached = wp_cache_get($cache_key, self::CACHE_GROUP);
		if ($cached !== false) {
			return $cached;
		}

		$identities_table = Npcink_Device_Inventory_V3_Tables::identities();
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery -- Plugin-owned identity table query is wrapped in the object cache.
		$items = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE asset_id = %d ORDER BY is_primary DESC, id ASC',
				$identities_table,
				$asset_id
			),
			ARRAY_A
		) ?: array();
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery
		wp_cache_set($cache_key, $items, self::CACHE_GROUP, self::CACHE_TTL);
		return $items;
	}

	/**
	 * Atomically claim a globally unique identity for an asset.
	 *
	 * The unique database key is the source of truth. Callers must inspect the
	 * returned status instead of treating a duplicate write as success.
	 */
	public function claim($asset_id, $identity, $is_primary = false)
	{
		global $wpdb;
		$asset_id = intval($asset_id);
		$type = isset($identity['type']) ? sanitize_key($identity['type']) : '';
		$value = isset($identity['value']) ? sanitize_text_field($identity['value']) : '';
		if ($asset_id <= 0 || !in_array($type, self::ALLOWED_TYPES, true) || $value === '') {
			return $this->claim_result(self::CLAIM_INVALID, null, $type, $value);
		}

		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned identity table write invalidates repository object-cache version after success.
		$result = $wpdb->query(
			$wpdb->prepare(
				'INSERT INTO %i
				(asset_id, identity_type, identity_value, confidence, is_primary, source)
				VALUES (%d, %s, %s, %f, %d, %s)
				ON DUPLICATE KEY UPDATE identity_value = identity_value',
				Npcink_Device_Inventory_V3_Tables::identities(),
				$asset_id,
				$type,
				$value,
				isset($identity['confidence']) ? floatval($identity['confidence']) : 100.0,
				$is_primary ? 1 : 0,
				isset($identity['source']) ? sanitize_key($identity['source']) : 'upload'
			)
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching

		if ($result === false) {
			return $this->claim_result(self::CLAIM_ERROR, null, $type, $value);
		}

		// Affected-row counts change when the connection enables CLIENT_FOUND_ROWS,
		// so ownership must always be verified from the unique row itself.
		$owner_asset_id = $this->find_owner_uncached($type, $value);
		if ($owner_asset_id === $asset_id) {
			if ($is_primary) {
				$this->mark_primary($asset_id, $type, $value);
			}
			if ($result === 1) {
				$this->bump_list_cache_version();
				return $this->claim_result(self::CLAIM_INSERTED, $owner_asset_id, $type, $value);
			}
			return $this->claim_result(self::CLAIM_OWNED, $owner_asset_id, $type, $value);
		}
		if ($owner_asset_id > 0) {
			return $this->claim_result(self::CLAIM_CONFLICT, $owner_asset_id, $type, $value);
		}

		return $this->claim_result(self::CLAIM_ERROR, null, $type, $value);
	}

	public function claim_many($asset_id, $identities)
	{
		$results = array();
		foreach (array_values(is_array($identities) ? $identities : array()) as $index => $identity) {
			$results[] = $this->claim($asset_id, $identity, $index === 0);
		}
		return $results;
	}

	private function find_owner_uncached($type, $value)
	{
		global $wpdb;
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- The unique row must be read immediately after an atomic claim attempt; a cached miss would be incorrect.
		$asset_id = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT asset_id FROM %i WHERE identity_type = %s AND identity_value = %s LIMIT 1',
				Npcink_Device_Inventory_V3_Tables::identities(),
				$type,
				$value
			)
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		return intval($asset_id);
	}

	private function mark_primary($asset_id, $type, $value)
	{
		global $wpdb;
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- This atomically selects one identity already owned by the requested asset as primary.
		$result = $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET is_primary = CASE WHEN identity_type = %s AND identity_value = %s THEN 1 ELSE 0 END WHERE asset_id = %d',
				Npcink_Device_Inventory_V3_Tables::identities(),
				$type,
				$value,
				$asset_id
			)
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		if ($result > 0) {
			$this->bump_list_cache_version();
		}
	}

	private function claim_result($status, $owner_asset_id, $type, $value)
	{
		return array(
			'status' => $status,
			'ownerAssetId' => $owner_asset_id === null ? null : intval($owner_asset_id),
			'identityType' => $type,
			'identityValue' => $value,
		);
	}

	private function bump_list_cache_version()
	{
		$version = $this->get_list_cache_version();
		wp_cache_set('list_version', $version + 1, self::CACHE_GROUP);
	}

	private function build_cache_key($prefix, $parts)
	{
		$encoded = wp_json_encode($parts);
		return $prefix . ':' . md5(is_string($encoded) ? $encoded : serialize($parts));
	}

	private function get_list_cache_version()
	{
		$version = wp_cache_get('list_version', self::CACHE_GROUP);
		if ($version === false) {
			$version = 1;
			wp_cache_set('list_version', $version, self::CACHE_GROUP);
		}
		return intval($version);
	}

}
