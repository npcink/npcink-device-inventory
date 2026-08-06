<?php

if (!defined('ABSPATH')) {
	exit;
}

class Npcink_Device_Inventory_Backup_Export_Service
{
	const SCHEMA = 'npcink-device-inventory/v3-admin-export';
	const MAX_BACKUP_BYTES = 52428800;
	const MAX_REQUEST_BYTES = 53477376;
	const MAX_SECTION_ROWS = 10000;
	const SECTIONS = array('settings', 'assets', 'identities', 'events', 'observations');

	public function export($requested_sections)
	{
		$sections = $this->normalize_sections($requested_sections);
		if (empty($sections)) {
			return Npcink_Device_Inventory_V3_Response::error('empty_backup', 'Select at least one backup section.', 422);
		}

		if (!$this->begin_snapshot()) {
			return Npcink_Device_Inventory_V3_Response::error('backup_snapshot_failed', 'Failed to start backup snapshot.', 500);
		}

		try {
			$counts = $this->section_counts($sections);
			foreach ($counts as $section => $count) {
				if ($count > self::MAX_SECTION_ROWS) {
					$this->rollback_snapshot();
					return Npcink_Device_Inventory_V3_Response::error(
						'backup_section_too_large',
						'Backup section exceeds the restorable row limit.',
						413,
						array('section' => $section, 'rows' => $count, 'limit' => self::MAX_SECTION_ROWS)
					);
				}
			}

			$backup = array(
				'schema' => self::SCHEMA,
				'exportedAt' => gmdate('c'),
				'sections' => $sections,
			);
			foreach ($sections as $section) {
				$backup[$section] = $this->export_section($section);
			}
			if (!$this->commit_snapshot()) {
				$this->rollback_snapshot();
				return Npcink_Device_Inventory_V3_Response::error('backup_snapshot_failed', 'Failed to finish backup snapshot.', 500);
			}
		} catch (Exception $exception) {
			$this->rollback_snapshot();
			return Npcink_Device_Inventory_V3_Response::error('backup_export_failed', 'Failed to export backup.', 500);
		}

		$encoded = wp_json_encode($backup);
		if (!is_string($encoded)) {
			return Npcink_Device_Inventory_V3_Response::error('backup_encode_failed', 'Failed to encode backup.', 500);
		}
		if (strlen($encoded) > self::MAX_BACKUP_BYTES) {
			return Npcink_Device_Inventory_V3_Response::error(
				'backup_too_large',
				'Backup exceeds the restorable file size limit.',
				413,
				array('bytes' => strlen($encoded), 'limit' => self::MAX_BACKUP_BYTES, 'counts' => $counts)
			);
		}

		return array(
			'backup' => $backup,
			'meta' => array(
				'bytes' => strlen($encoded),
				'counts' => $counts,
				'limits' => array('bytes' => self::MAX_BACKUP_BYTES, 'rowsPerSection' => self::MAX_SECTION_ROWS),
			),
		);
	}

	private function normalize_sections($requested_sections)
	{
		if (is_string($requested_sections)) {
			$requested_sections = explode(',', $requested_sections);
		}
		if (!is_array($requested_sections)) {
			return self::SECTIONS;
		}
		$sections = array();
		foreach ($requested_sections as $section) {
			$section = sanitize_key((string) $section);
			if (in_array($section, self::SECTIONS, true) && !in_array($section, $sections, true)) {
				$sections[] = $section;
			}
		}
		return $sections;
	}

	private function section_counts($sections)
	{
		$counts = array();
		foreach ($sections as $section) {
			if ($section === 'settings') {
				$counts[$section] = 1;
				continue;
			}
			$counts[$section] = $this->table_count($this->table_for_section($section));
		}
		return $counts;
	}

	private function table_for_section($section)
	{
		$tables = array(
			'assets' => Npcink_Device_Inventory_V3_Tables::assets(),
			'identities' => Npcink_Device_Inventory_V3_Tables::identities(),
			'events' => Npcink_Device_Inventory_V3_Tables::events(),
			'observations' => Npcink_Device_Inventory_V3_Tables::observations(),
		);
		return isset($tables[$section]) ? $tables[$section] : '';
	}

	private function table_count($table)
	{
		global $wpdb;
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Backup reads plugin-owned tables inside one consistent snapshot.
		$count = $wpdb->get_var($wpdb->prepare('SELECT COUNT(*) FROM %i', $table));
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		if ($count === null) {
			throw new Exception('Failed to count backup rows.');
		}
		return intval($count);
	}

	private function export_section($section)
	{
		if ($section === 'settings') {
			return $this->export_settings();
		}
		if ($section === 'assets') {
			return array_map(array($this, 'format_asset'), $this->asset_rows());
		}
		if ($section === 'identities') {
			return $this->format_identity_groups($this->identity_rows());
		}
		if ($section === 'events') {
			return array_map(array($this, 'format_event'), $this->event_rows());
		}
		if ($section === 'observations') {
			return array_map(array($this, 'format_observation'), $this->observation_rows());
		}
		throw new Exception('Unsupported backup section.');
	}

	private function export_settings()
	{
		$options = Npcink_Device_Inventory_V3_Tables::options();
		return array(
			'observationRetentionDays' => intval($options['observation_retention_days']),
			'assetNumberPrefix' => (string) $options['asset_number_prefix'],
			'depreciationPeriodMonths' => intval($options['depreciation_period_months']),
			'defaultResidualRate' => floatval($options['default_residual_rate']),
			'renewalAgeYears' => intval($options['renewal_age_years']),
			'renewalMinMemoryGb' => intval($options['renewal_min_memory_gb']),
			'renewalMinDiskGb' => intval($options['renewal_min_disk_gb']),
			'renewalMaxResidualRate' => floatval($options['renewal_max_residual_rate']),
			'countAvailableAssetsOnly' => !empty($options['count_available_assets_only']),
			'departments' => Npcink_Device_Inventory_V3_Tables::normalize_departments_with_default($options['departments']),
			'deleteDataOnUninstall' => !empty($options['delete_data_on_uninstall']),
		);
	}

	private function asset_rows()
	{
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Backup reads plugin-owned tables inside one consistent snapshot.
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, uuid, asset_type, asset_number, name, owner_name, department, status, category, purchase_price, residual_value, financial_residual_value, metadata_json, created_at, updated_at FROM %i ORDER BY id ASC',
				Npcink_Device_Inventory_V3_Tables::assets()
			),
			ARRAY_A
		);
		return $this->validated_rows($rows);
	}

	private function identity_rows()
	{
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Backup reads plugin-owned tables inside one consistent snapshot.
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT i.*, a.uuid AS asset_uuid, a.asset_number FROM %i i INNER JOIN %i a ON a.id = i.asset_id ORDER BY i.asset_id ASC, i.is_primary DESC, i.id ASC',
				Npcink_Device_Inventory_V3_Tables::identities(),
				Npcink_Device_Inventory_V3_Tables::assets()
			),
			ARRAY_A
		);
		return $this->validated_rows($rows);
	}

	private function event_rows()
	{
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Backup reads plugin-owned tables inside one consistent snapshot.
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT e.*, a.uuid AS asset_uuid, a.asset_number FROM %i e LEFT JOIN %i a ON a.id = e.asset_id ORDER BY e.id ASC',
				Npcink_Device_Inventory_V3_Tables::events(),
				Npcink_Device_Inventory_V3_Tables::assets()
			),
			ARRAY_A
		);
		return $this->validated_rows($rows);
	}

	private function observation_rows()
	{
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Backup reads plugin-owned tables inside one consistent snapshot.
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT o.*, a.uuid AS asset_uuid, a.asset_number FROM %i o INNER JOIN %i a ON a.id = o.asset_id ORDER BY o.id ASC',
				Npcink_Device_Inventory_V3_Tables::observations(),
				Npcink_Device_Inventory_V3_Tables::assets()
			),
			ARRAY_A
		);
		return $this->validated_rows($rows);
	}

	private function validated_rows($rows)
	{
		if (!is_array($rows)) {
			throw new Exception('Failed to read backup rows.');
		}
		return $rows;
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
			'metadata' => $this->decode_json($row['metadata_json']),
			'createdAt' => (string) $row['created_at'],
			'updatedAt' => (string) $row['updated_at'],
		);
	}

	private function format_identity_groups($rows)
	{
		$groups = array();
		foreach ($rows as $row) {
			$key = (string) $row['asset_id'];
			if (!isset($groups[$key])) {
				$groups[$key] = array(
					'assetId' => intval($row['asset_id']),
					'assetUuid' => (string) $row['asset_uuid'],
					'assetNumber' => (string) $row['asset_number'],
					'identities' => array(),
				);
			}
			$groups[$key]['identities'][] = array(
				'identityType' => (string) $row['identity_type'],
				'identityValue' => (string) $row['identity_value'],
				'confidence' => floatval($row['confidence']),
				'isPrimary' => intval($row['is_primary']) === 1,
				'source' => (string) $row['source'],
				'createdAt' => (string) $row['created_at'],
			);
		}
		return array_values($groups);
	}

	private function format_event($row)
	{
		return array(
			'assetId' => $row['asset_id'] === null ? null : intval($row['asset_id']),
			'assetUuid' => isset($row['asset_uuid']) ? (string) $row['asset_uuid'] : '',
			'assetNumber' => isset($row['asset_number']) ? (string) $row['asset_number'] : '',
			'eventSource' => (string) $row['event_source'],
			'eventType' => (string) $row['event_type'],
			'fieldName' => (string) $row['field_name'],
			'oldValue' => (string) $row['old_value'],
			'newValue' => (string) $row['new_value'],
			'message' => (string) $row['message'],
			'actorUserId' => $row['actor_user_id'] === null ? null : intval($row['actor_user_id']),
			'actorName' => (string) $row['actor_name'],
			'payload' => $this->decode_json($row['payload_json']),
			'createdAt' => (string) $row['created_at'],
		);
	}

	private function format_observation($row)
	{
		return array(
			'assetId' => intval($row['asset_id']),
			'assetUuid' => (string) $row['asset_uuid'],
			'assetNumber' => (string) $row['asset_number'],
			'source' => (string) $row['source'],
			'schemaVersion' => intval($row['schema_version']),
			'observedAt' => (string) $row['observed_at'],
			'receivedAt' => (string) $row['received_at'],
			'summary' => $this->decode_json($row['summary_json']),
			'hardware' => $this->decode_json($row['hardware_json']),
			'raw' => $this->decode_json($row['raw_json']),
		);
	}

	private function decode_json($value)
	{
		$decoded = is_string($value) ? json_decode($value, true) : null;
		return is_array($decoded) ? $decoded : array();
	}

	private function begin_snapshot()
	{
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Backup sections must share one database snapshot.
		return $wpdb->query('START TRANSACTION WITH CONSISTENT SNAPSHOT') !== false;
	}

	private function commit_snapshot()
	{
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Finish the read-only backup snapshot.
		return $wpdb->query('COMMIT') !== false;
	}

	private function rollback_snapshot()
	{
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Close a failed backup snapshot.
		$wpdb->query('ROLLBACK');
	}
}
