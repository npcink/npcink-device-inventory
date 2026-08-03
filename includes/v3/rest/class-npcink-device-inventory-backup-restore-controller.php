<?php

if (!defined('ABSPATH')) {
	exit;
}

class Npcink_Device_Inventory_Backup_Restore_Conflict_Exception extends Exception
{
	private $summary;

	public function __construct($summary)
	{
		parent::__construct('Backup restore conflict detected during import.', 409);
		$this->summary = $summary;
	}

	public function get_summary()
	{
		return $this->summary;
	}
}

class Npcink_Device_Inventory_Backup_Restore_Controller
{
	const IDENTITY_TYPES = array('system_uuid_v2', 'baseboard_serial_v2', 'pci_permanent_mac_v2', 'device_uuid_v1', 'fallback_device_v1');
	const REMOVED_EVENT_TYPES = array('issue_handled', 'issue_reopened', 'identity_reconciled');

	private $exporter;

	public function __construct(?Npcink_Device_Inventory_Backup_Export_Service $exporter = null)
	{
		$this->exporter = $exporter ? $exporter : new Npcink_Device_Inventory_Backup_Export_Service();
	}

	public function register_routes()
	{
		register_rest_route(
			'npcink-device-inventory/v1',
			'/backup',
			array(
				'methods' => WP_REST_Server::READABLE,
				'callback' => array($this, 'export_backup'),
				'permission_callback' => array($this, 'admin_permissions_check'),
			)
		);
		register_rest_route(
			'npcink-device-inventory/v1',
			'/backup-restore',
			array(
				'methods' => WP_REST_Server::CREATABLE,
				'callback' => array($this, 'restore_backup'),
				'permission_callback' => array($this, 'admin_permissions_check'),
			)
		);
	}

	public function export_backup($request)
	{
		$sections = $request instanceof WP_REST_Request ? $request->get_param('sections') : null;
		$result = $this->exporter->export($sections);
		if (is_wp_error($result)) {
			return $result;
		}
		return rest_ensure_response(array('data' => $result));
	}

	public function admin_permissions_check()
	{
		if (!current_user_can('manage_options')) {
			return Npcink_Device_Inventory_V3_Response::error('forbidden', 'Administrator permission is required.', 403);
		}
		return true;
	}

	public function restore_backup($request)
	{
		$content_length = $request instanceof WP_REST_Request ? intval($request->get_header('content-length')) : 0;
		if ($content_length > Npcink_Device_Inventory_Backup_Export_Service::MAX_REQUEST_BYTES) {
			return Npcink_Device_Inventory_V3_Response::error('backup_too_large', 'Backup JSON is too large.', 413);
		}

		$body = $request instanceof WP_REST_Request ? (string) $request->get_body() : '';
		if ($body !== '' && strlen($body) > Npcink_Device_Inventory_Backup_Export_Service::MAX_REQUEST_BYTES) {
			return Npcink_Device_Inventory_V3_Response::error('backup_too_large', 'Backup JSON is too large.', 413);
		}

		$params = $request->get_json_params();
		if (!is_array($params) || !isset($params['backup']) || !is_array($params['backup'])) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_backup', 'Backup JSON is required.', 400);
		}

		$backup = $params['backup'];
		$encoded_backup = wp_json_encode($backup);
		if (!is_string($encoded_backup) || strlen($encoded_backup) > Npcink_Device_Inventory_Backup_Export_Service::MAX_BACKUP_BYTES) {
			return Npcink_Device_Inventory_V3_Response::error('backup_too_large', 'Backup JSON is too large.', 413);
		}
		$dry_run = !empty($params['dryRun']);
		$validation = $this->validate_backup($backup);
		if (is_wp_error($validation)) {
			return $validation;
		}

		$summary = $this->build_restore_plan($backup);
		if ($dry_run) {
			return rest_ensure_response(
				array(
					'data' => array(
						'dryRun' => true,
						'summary' => $summary,
					),
				)
			);
		}

		if (!empty($summary['conflicts'])) {
			return Npcink_Device_Inventory_V3_Response::error('backup_conflicts', 'Backup has restore conflicts. Review the preview before importing.', 409, $summary);
		}

		try {
			$result = $this->import_backup($backup, $summary);
		} catch (Npcink_Device_Inventory_Backup_Restore_Conflict_Exception $exception) {
			return Npcink_Device_Inventory_V3_Response::error('backup_conflicts', $exception->getMessage(), 409, $exception->get_summary());
		} catch (Exception $exception) {
			return Npcink_Device_Inventory_V3_Response::error('backup_restore_failed', $exception->getMessage(), 500);
		}

		return rest_ensure_response(
			array(
				'data' => array(
					'dryRun' => false,
					'summary' => $result,
				),
			)
		);
	}

	private function validate_backup($backup)
	{
		$schema = isset($backup['schema']) ? (string) $backup['schema'] : '';
		if ($schema !== Npcink_Device_Inventory_Backup_Export_Service::SCHEMA) {
			return Npcink_Device_Inventory_V3_Response::error('unsupported_backup_schema', 'Unsupported backup schema.', 422);
		}

		$has_known_section = false;
		foreach (array('settings', 'assets', 'identities', 'events', 'observations') as $section) {
			if (!array_key_exists($section, $backup)) {
				continue;
			}
			$has_known_section = true;
			if ($section === 'settings') {
				if (!is_array($backup[$section])) {
					return Npcink_Device_Inventory_V3_Response::error('invalid_backup_section', 'Settings section must be an object.', 422);
				}
				continue;
			}
			if (!is_array($backup[$section])) {
				return Npcink_Device_Inventory_V3_Response::error('invalid_backup_section', 'Backup sections must be arrays.', 422);
			}
			$row_count = $section === 'identities' ? $this->count_backup_identities($backup[$section]) : count($backup[$section]);
			if ($row_count > Npcink_Device_Inventory_Backup_Export_Service::MAX_SECTION_ROWS) {
				return Npcink_Device_Inventory_V3_Response::error('backup_section_too_large', 'Backup section contains too many rows.', 413);
			}
		}

		if (!$has_known_section) {
			return Npcink_Device_Inventory_V3_Response::error('empty_backup', 'Backup does not contain importable sections.', 422);
		}

		return true;
	}

	private function build_restore_plan($backup)
	{
		$summary = $this->empty_summary($backup);
		$asset_map = $this->empty_asset_map();

		if (isset($backup['settings']) && is_array($backup['settings'])) {
			$summary['planned']['settings'] = 1;
		}
		if (isset($backup['assets']) && is_array($backup['assets'])) {
			$result = $this->process_assets($backup['assets'], $summary, $asset_map, false);
			$summary = $result['summary'];
			$asset_map = $result['asset_map'];
		}
		if (isset($backup['identities']) && is_array($backup['identities'])) {
			$summary = $this->process_identities($backup['identities'], $summary, $asset_map, false);
		}
		if (isset($backup['observations']) && is_array($backup['observations'])) {
			$summary = $this->process_observations($backup['observations'], $summary, $asset_map, false);
		}
		if (isset($backup['events']) && is_array($backup['events'])) {
			$summary = $this->process_events($backup['events'], $summary, $asset_map, false);
		}

		return $summary;
	}

	private function empty_summary($backup)
	{
		$identity_count = 0;
		if (!empty($backup['identities']) && is_array($backup['identities'])) {
			foreach ($backup['identities'] as $item) {
				$identity_count += is_array($item) && isset($item['identities']) && is_array($item['identities']) ? count($item['identities']) : 1;
			}
		}

		return array(
			'schema' => isset($backup['schema']) ? (string) $backup['schema'] : '',
			'exportedAt' => isset($backup['exportedAt']) ? sanitize_text_field((string) $backup['exportedAt']) : '',
			'available' => array(
				'settings' => isset($backup['settings']) && is_array($backup['settings']) ? 1 : 0,
				'assets' => isset($backup['assets']) && is_array($backup['assets']) ? count($backup['assets']) : 0,
				'identities' => $identity_count,
				'events' => isset($backup['events']) && is_array($backup['events']) ? count($backup['events']) : 0,
				'observations' => isset($backup['observations']) && is_array($backup['observations']) ? count($backup['observations']) : 0,
			),
			'planned' => array(
				'settings' => 0,
				'assetsCreated' => 0,
				'assetsUpdated' => 0,
				'identitiesCreated' => 0,
				'identitiesExisting' => 0,
				'observationsCreated' => 0,
				'observationsExisting' => 0,
				'eventsCreated' => 0,
				'eventsExisting' => 0,
			),
			'imported' => array(
				'settings' => 0,
				'assetsCreated' => 0,
				'assetsUpdated' => 0,
				'identitiesCreated' => 0,
				'observationsCreated' => 0,
				'eventsCreated' => 0,
			),
			'skipped' => array(
				'assets' => 0,
				'identities' => 0,
				'observations' => 0,
				'events' => 0,
			),
			'conflicts' => array(),
			'warnings' => array(
				'上传授权码和客户端上传基础 URL 不会从备份恢复，请在正式站点重新配置。',
				'导入采用合并/更新策略，不会清空正式站点现有数据。',
			),
		);
	}

	private function import_backup($backup, $summary)
	{
		global $wpdb;
		$asset_map = $this->empty_asset_map();
		$previous_options = get_option(Npcink_Device_Inventory_V3_Tables::OPTION, array());
		$settings_imported = false;
		$planned_summary = $summary;
		$summary = $this->empty_summary($backup);
		$summary['planned'] = $planned_summary['planned'];
		$summary['warnings'] = $planned_summary['warnings'];

		try {
			if (isset($backup['settings']) && is_array($backup['settings'])) {
				$settings_imported = true;
				$summary = $this->import_settings($backup['settings'], $summary);
			}

			// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Restore spans plugin-owned tables and needs transaction boundaries.
			if ($wpdb->query('START TRANSACTION') === false) {
				throw new Exception('Failed to start backup restore transaction.');
			}
			// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching

			if (isset($backup['assets']) && is_array($backup['assets'])) {
				$result = $this->process_assets($backup['assets'], $summary, $asset_map, true);
				$summary = $result['summary'];
				$asset_map = $result['asset_map'];
				$this->assert_no_import_conflicts($summary);
			}
			if (isset($backup['identities']) && is_array($backup['identities'])) {
				$summary = $this->process_identities($backup['identities'], $summary, $asset_map, true);
				$this->assert_no_import_conflicts($summary);
			}
			if (isset($backup['observations']) && is_array($backup['observations'])) {
				$summary = $this->process_observations($backup['observations'], $summary, $asset_map, true);
				$this->assert_no_import_conflicts($summary);
			}
			if (isset($backup['events']) && is_array($backup['events'])) {
				$summary = $this->process_events($backup['events'], $summary, $asset_map, true);
				$this->assert_no_import_conflicts($summary);
			}

			// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- See transaction note above.
			if ($wpdb->query('COMMIT') === false) {
				throw new Exception('Failed to commit backup restore transaction.');
			}
			// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		} catch (Exception $exception) {
			// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- See transaction note above.
			$wpdb->query('ROLLBACK');
			// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
			if ($settings_imported) {
				update_option(Npcink_Device_Inventory_V3_Tables::OPTION, $previous_options);
			}
			throw $exception;
		}

		$this->bump_cache_versions();

		return $summary;
	}

	private function import_settings($settings, $summary)
	{
		$options = Npcink_Device_Inventory_V3_Tables::options();
		if (array_key_exists('observationRetentionDays', $settings)) {
			$options['observation_retention_days'] = max(0, intval($settings['observationRetentionDays']));
		}
		if (array_key_exists('assetNumberPrefix', $settings)) {
			$options['asset_number_prefix'] = preg_replace('/[^A-Za-z0-9_-]/', '', (string) $settings['assetNumberPrefix']);
		}
		if (array_key_exists('depreciationPeriodMonths', $settings)) {
			$options['depreciation_period_months'] = max(1, intval($settings['depreciationPeriodMonths']));
		}
		if (array_key_exists('defaultResidualRate', $settings)) {
			$options['default_residual_rate'] = min(100, max(0, floatval($settings['defaultResidualRate'])));
		}
		if (array_key_exists('countAvailableAssetsOnly', $settings)) {
			$options['count_available_assets_only'] = (bool) $settings['countAvailableAssetsOnly'];
		}
		if (array_key_exists('departments', $settings)) {
			$options['departments'] = Npcink_Device_Inventory_V3_Tables::normalize_departments_with_default($settings['departments']);
		}
		if (array_key_exists('deleteDataOnUninstall', $settings)) {
			$options['delete_data_on_uninstall'] = (bool) $settings['deleteDataOnUninstall'];
		}

		update_option(Npcink_Device_Inventory_V3_Tables::OPTION, $options);
		$summary['imported']['settings'] = 1;
		return $summary;
	}

	private function process_assets($assets, $summary, $asset_map, $mutate)
	{
		global $wpdb;
		$seen_uuids = array();
		$seen_numbers = array();
		foreach ($assets as $index => $asset) {
			if (!is_array($asset)) {
				$summary['skipped']['assets']++;
				$this->add_warning($summary, '资产台账第 ' . ($index + 1) . ' 行格式无效，已跳过。');
				continue;
			}

			$row = $this->asset_row_from_backup($asset);
			if ($row['asset_number'] === '') {
				$summary['skipped']['assets']++;
				$this->add_warning($summary, '资产台账第 ' . ($index + 1) . ' 行缺少资产编号，已跳过。');
				continue;
			}
			$uuid_was_missing = $row['uuid'] === '';
			if ($uuid_was_missing) {
				$row['uuid'] = $mutate ? $this->generate_unique_asset_uuid() : '__preview_missing_uuid_' . ($index + 1);
				$this->add_warning($summary, '资产 ' . $row['asset_number'] . ' 缺少 UUID，导入时会生成新 UUID。');
			}
			if (((!$uuid_was_missing || $mutate) && isset($seen_uuids[$row['uuid']])) || isset($seen_numbers[$row['asset_number']])) {
				$summary['skipped']['assets']++;
				$summary['conflicts'][] = '备份内资产 UUID 或编号重复：' . $row['asset_number'];
				continue;
			}
			if (!$uuid_was_missing || $mutate) {
				$seen_uuids[$row['uuid']] = true;
			}
			$seen_numbers[$row['asset_number']] = true;

			$by_uuid = $uuid_was_missing && !$mutate ? null : $this->find_asset_by_uuid($row['uuid']);
			$by_number = $this->find_asset_by_number($row['asset_number']);
			if ($by_uuid && $by_number && intval($by_uuid['id']) !== intval($by_number['id'])) {
				$summary['skipped']['assets']++;
				$summary['conflicts'][] = '资产冲突：UUID ' . $row['uuid'] . ' 与资产编号 ' . $row['asset_number'] . ' 分别命中不同资产。';
				continue;
			}

			$existing = $by_uuid ? $by_uuid : $by_number;
			if ($existing) {
				$asset_id = intval($existing['id']);
				if ($mutate) {
					$update_row = $this->asset_update_row($row, $by_uuid ? true : false);
					// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned table restore.
					$result = $wpdb->update(
						Npcink_Device_Inventory_V3_Tables::assets(),
						$update_row['row'],
						array('id' => $asset_id),
						$update_row['formats'],
						array('%d')
					);
					// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
					if ($result === false) {
						throw new Exception('Failed to update asset backup row.');
					}
					$summary['imported']['assetsUpdated']++;
				} else {
					$summary['planned']['assetsUpdated']++;
				}
			} else {
				if ($mutate) {
					// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned table restore.
					$result = $wpdb->insert(
						Npcink_Device_Inventory_V3_Tables::assets(),
						$row,
						array('%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%f', '%f', '%s', '%s', '%s')
					);
					// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
					if ($result === false) {
						throw new Exception('Failed to create asset backup row.');
					}
					$asset_id = intval($wpdb->insert_id);
					$summary['imported']['assetsCreated']++;
				} else {
					$asset_id = -1 * (count($asset_map['by_number']) + 1);
					$summary['planned']['assetsCreated']++;
				}
			}

			$this->remember_asset($asset_map, $asset, $asset_id, $row['uuid'], $row['asset_number']);
		}

		return array('summary' => $summary, 'asset_map' => $asset_map);
	}

	private function process_identities($groups, $summary, $asset_map, $mutate)
	{
		global $wpdb;
		$seen_identities = array();
		foreach ($groups as $group) {
			if (!is_array($group)) {
				$summary['skipped']['identities']++;
				$this->add_warning($summary, '设备匹配标识存在无效分组，已跳过。');
				continue;
			}

			$identity_items = isset($group['identities']) && is_array($group['identities']) ? $group['identities'] : array($group);
			$asset_id = $this->asset_id_from_backup_reference($group, $asset_map);

			foreach ($identity_items as $identity) {
				if (!is_array($identity)) {
					$summary['skipped']['identities']++;
					continue;
				}
				$current_asset_id = $asset_id ? $asset_id : $this->asset_id_from_backup_reference($identity, $asset_map);
				$type = $this->backup_text($identity, array('identityType', 'type'), 'key');
				$value = $this->backup_text($identity, array('identityValue', 'value'), 'text');
				if (!$current_asset_id || !in_array($type, self::IDENTITY_TYPES, true) || $value === '') {
					$summary['skipped']['identities']++;
					$this->add_warning($summary, '设备匹配标识缺少资产、使用旧类型或缺少值，已跳过。');
					continue;
				}
				$identity_key = $type . "\0" . $value;
				if (isset($seen_identities[$identity_key])) {
					$summary['skipped']['identities']++;
					if (intval($seen_identities[$identity_key]) !== intval($current_asset_id)) {
						$summary['conflicts'][] = '备份内设备匹配标识冲突：' . $type . '=' . $value . ' 指向多个资产。';
					} else {
						$this->add_warning($summary, '备份内设备匹配标识重复：' . $type . '=' . $value . '，重复项已跳过。');
					}
					continue;
				}
				$seen_identities[$identity_key] = intval($current_asset_id);

				$existing_asset_id = $this->identity_asset_id($type, $value);
				if ($existing_asset_id) {
					if ($current_asset_id < 1 || intval($existing_asset_id) !== intval($current_asset_id)) {
						$summary['conflicts'][] = '设备匹配标识冲突：' . $type . '=' . $value . ' 已属于其他资产。';
					} elseif (!$mutate) {
						$summary['planned']['identitiesExisting']++;
					}
					$summary['skipped']['identities']++;
					continue;
				}

				if ($mutate) {
					if ($current_asset_id < 1) {
						$summary['skipped']['identities']++;
						continue;
					}
					// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned table restore.
					$result = $wpdb->insert(
						Npcink_Device_Inventory_V3_Tables::identities(),
						array(
							'asset_id' => $current_asset_id,
							'identity_type' => $type,
							'identity_value' => $value,
							'confidence' => isset($identity['confidence']) ? floatval($identity['confidence']) : 100,
							'is_primary' => !empty($identity['isPrimary']) ? 1 : 0,
							'source' => $this->backup_text($identity, array('source'), 'key', 'import'),
							'created_at' => $this->backup_datetime($identity, 'createdAt', false),
						),
						array('%d', '%s', '%s', '%f', '%d', '%s', '%s')
					);
					// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
					if ($result === false) {
						throw new Exception('Failed to create identity backup row.');
					}
					$summary['imported']['identitiesCreated']++;
				} else {
					$summary['planned']['identitiesCreated']++;
				}
			}
		}
		return $summary;
	}

	private function process_observations($observations, $summary, $asset_map, $mutate)
	{
		global $wpdb;
		$should_sync_latest = false;
		foreach ($observations as $observation) {
			if (!is_array($observation)) {
				$summary['skipped']['observations']++;
				continue;
			}
			$asset_id = $this->asset_id_from_backup_reference($observation, $asset_map);
			$source = $this->backup_text($observation, array('source'), 'key', 'import');
			$observed_at = $this->backup_datetime($observation, 'observedAt', true);
			$received_at = $this->backup_datetime($observation, 'receivedAt', false);
			$schema_version = isset($observation['schemaVersion']) ? max(1, intval($observation['schemaVersion'])) : 1;
			if (!$asset_id || $observed_at === '') {
				$summary['skipped']['observations']++;
				$this->add_warning($summary, '电脑采集快照缺少资产或有效采集时间，已跳过。');
				continue;
			}
			if ($mutate && $asset_id > 0) {
				$should_sync_latest = true;
			}
			if ($asset_id > 0 && $this->observation_exists($asset_id, $source, $schema_version, $observed_at)) {
				if (!$mutate) {
					$summary['planned']['observationsExisting']++;
				}
				$summary['skipped']['observations']++;
				continue;
			}

			if ($mutate) {
				if ($asset_id < 1) {
					$summary['skipped']['observations']++;
					continue;
				}
				// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned table restore.
				$result = $wpdb->insert(
					Npcink_Device_Inventory_V3_Tables::observations(),
					array(
						'asset_id' => $asset_id,
						'source' => $source,
						'schema_version' => $schema_version,
						'observed_at' => $observed_at,
						'received_at' => $received_at,
						'summary_json' => $this->safe_json_field($observation, 'summary'),
						'hardware_json' => $this->safe_json_field($observation, 'hardware'),
						'raw_json' => $this->safe_json_field($observation, 'raw'),
					),
					array('%d', '%s', '%d', '%s', '%s', '%s', '%s', '%s')
				);
				// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
				if ($result === false) {
					throw new Exception('Failed to create observation backup row.');
				}
				$summary['imported']['observationsCreated']++;
			} else {
				$summary['planned']['observationsCreated']++;
			}
		}
		if ($mutate && $should_sync_latest) {
			$this->sync_latest_observation_columns();
		}
		return $summary;
	}

	private function process_events($events, $summary, $asset_map, $mutate)
	{
		global $wpdb;
		foreach ($events as $event) {
			if (!is_array($event)) {
				$summary['skipped']['events']++;
				continue;
			}

			$asset_id = $this->asset_id_from_backup_reference($event, $asset_map);
			$created_at = $this->backup_datetime($event, 'createdAt', true);
			$event_source = $this->backup_text($event, array('eventSource'), 'key', 'import');
			$event_type = $this->backup_text($event, array('eventType'), 'key', 'restored');
			$message = $this->backup_text($event, array('message'), 'textarea');
			if (in_array($event_type, self::REMOVED_EVENT_TYPES, true)) {
				$summary['skipped']['events']++;
				$this->add_warning($summary, '备份包含已删除工作流的变更记录，已跳过。');
				continue;
			}
			if ($created_at === '') {
				$summary['skipped']['events']++;
				$this->add_warning($summary, '变更记录缺少有效创建时间，已跳过。');
				continue;
			}
			if ($asset_id > 0 && $this->event_exists($asset_id, $event_source, $event_type, $message, $created_at)) {
				if (!$mutate) {
					$summary['planned']['eventsExisting']++;
				}
				$summary['skipped']['events']++;
				continue;
			}

			if ($mutate) {
				// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned table restore.
				$result = $wpdb->insert(
					Npcink_Device_Inventory_V3_Tables::events(),
					array(
						'asset_id' => $asset_id > 0 ? $asset_id : null,
						'event_source' => $event_source,
						'event_type' => $event_type,
						'field_name' => $this->backup_text($event, array('fieldName'), 'text'),
						'old_value' => $this->backup_text($event, array('oldValue'), 'textarea'),
						'new_value' => $this->backup_text($event, array('newValue'), 'textarea'),
						'message' => $message,
						'actor_user_id' => isset($event['actorUserId']) ? intval($event['actorUserId']) : null,
						'actor_name' => $this->backup_text($event, array('actorName'), 'text'),
						'payload_json' => $this->safe_json_field($event, 'payload'),
						'created_at' => $created_at,
					),
					array('%d', '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%s')
				);
				// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
				if ($result === false) {
					throw new Exception('Failed to create event backup row.');
				}
				$summary['imported']['eventsCreated']++;
			} else {
				$summary['planned']['eventsCreated']++;
			}
		}
		return $summary;
	}

	private function asset_row_from_backup($asset)
	{
		$legacy_asset_type = $this->backup_text($asset, array('assetType'), 'key', 'custom');
		$asset_type = in_array($legacy_asset_type, array('pc', 'computer'), true) ? 'computer' : 'custom';
		$category = $this->backup_text($asset, array('category'), 'text');
		if ($asset_type === 'custom' && $category === '' && $legacy_asset_type !== 'custom') {
			$category = $legacy_asset_type;
		}

		return array(
			'uuid' => $this->backup_text($asset, array('uuid'), 'text'),
			'asset_type' => $asset_type,
			'asset_number' => $this->backup_text($asset, array('assetNumber'), 'text'),
			'name' => $this->backup_text($asset, array('name'), 'text'),
			'owner_name' => $this->backup_text($asset, array('ownerName'), 'text'),
			'department' => Npcink_Device_Inventory_V3_Tables::normalize_department($this->backup_text($asset, array('department'), 'text')),
			'status' => $this->backup_text($asset, array('status'), 'key', 'active'),
			'category' => $category,
			'purchase_price' => isset($asset['purchasePrice']) ? floatval($asset['purchasePrice']) : 0,
			'residual_value' => isset($asset['residualValue']) ? floatval($asset['residualValue']) : 0,
			'metadata_json' => $this->safe_json_field($asset, 'metadata'),
			'created_at' => $this->backup_datetime($asset, 'createdAt', false),
			'updated_at' => $this->backup_datetime($asset, 'updatedAt', false),
		);
	}

	private function asset_update_row($row, $matched_by_uuid)
	{
		$update = array(
			'asset_type' => $row['asset_type'],
			'name' => $row['name'],
			'owner_name' => $row['owner_name'],
			'department' => $row['department'],
			'status' => $row['status'],
			'category' => $row['category'],
			'purchase_price' => $row['purchase_price'],
			'residual_value' => $row['residual_value'],
			'metadata_json' => $row['metadata_json'],
			'updated_at' => current_time('mysql'),
		);
		$formats = array('%s', '%s', '%s', '%s', '%s', '%s', '%f', '%f', '%s', '%s');
		if ($matched_by_uuid) {
			$update['asset_number'] = $row['asset_number'];
			$formats[] = '%s';
		}

		return array('row' => $update, 'formats' => $formats);
	}

	private function find_asset_by_uuid($uuid)
	{
		if ($uuid === '') {
			return null;
		}
		global $wpdb;
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned restore lookup.
		$row = $wpdb->get_row(
			$wpdb->prepare('SELECT * FROM %i WHERE uuid = %s LIMIT 1', Npcink_Device_Inventory_V3_Tables::assets(), $uuid),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		return $row;
	}

	private function find_asset_by_number($asset_number)
	{
		if ($asset_number === '') {
			return null;
		}
		global $wpdb;
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned restore lookup.
		$row = $wpdb->get_row(
			$wpdb->prepare('SELECT * FROM %i WHERE asset_number = %s LIMIT 1', Npcink_Device_Inventory_V3_Tables::assets(), $asset_number),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		return $row;
	}

	private function remember_asset(&$asset_map, $asset, $asset_id, $uuid, $asset_number)
	{
		if (isset($asset['id'])) {
			$asset_map['by_old_id'][intval($asset['id'])] = $asset_id;
		}
		if ($uuid !== '') {
			$asset_map['by_uuid'][$uuid] = $asset_id;
		}
		if ($asset_number !== '') {
			$asset_map['by_number'][$asset_number] = $asset_id;
		}
	}

	private function asset_id_from_backup_reference($item, $asset_map)
	{
		$uuid = '';
		$asset_number = '';
		if (isset($item['asset']) && is_array($item['asset'])) {
			$asset = $item['asset'];
			$uuid = !empty($asset['uuid']) ? (string) $asset['uuid'] : '';
			$asset_number = !empty($asset['assetNumber']) ? (string) $asset['assetNumber'] : '';
			if ($uuid !== '' && isset($asset_map['by_uuid'][$uuid])) {
				return intval($asset_map['by_uuid'][$uuid]);
			}
			if ($asset_number !== '' && isset($asset_map['by_number'][$asset_number])) {
				return intval($asset_map['by_number'][$asset_number]);
			}
		}
		if (!empty($item['assetUuid']) && isset($asset_map['by_uuid'][(string) $item['assetUuid']])) {
			return intval($asset_map['by_uuid'][(string) $item['assetUuid']]);
		}
		if (!empty($item['assetNumber']) && isset($asset_map['by_number'][(string) $item['assetNumber']])) {
			return intval($asset_map['by_number'][(string) $item['assetNumber']]);
		}
		if (!empty($item['assetUuid'])) {
			$uuid = (string) $item['assetUuid'];
		}
		if (!empty($item['assetNumber'])) {
			$asset_number = (string) $item['assetNumber'];
		}
		if (isset($item['assetId']) && isset($asset_map['by_old_id'][intval($item['assetId'])])) {
			return intval($asset_map['by_old_id'][intval($item['assetId'])]);
		}
		if ($uuid !== '') {
			$existing = $this->find_asset_by_uuid($uuid);
			if ($existing) {
				return intval($existing['id']);
			}
		}
		if ($asset_number !== '') {
			$existing = $this->find_asset_by_number($asset_number);
			if ($existing) {
				return intval($existing['id']);
			}
		}
		return 0;
	}

	private function identity_asset_id($type, $value)
	{
		global $wpdb;
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned restore lookup.
		$asset_id = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT asset_id FROM %i WHERE identity_type = %s AND identity_value = %s LIMIT 1',
				Npcink_Device_Inventory_V3_Tables::identities(),
				$type,
				$value
			)
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		return $asset_id ? intval($asset_id) : 0;
	}

	private function observation_exists($asset_id, $source, $schema_version, $observed_at)
	{
		global $wpdb;
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned restore lookup.
		$found = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT id FROM %i WHERE asset_id = %d AND source = %s AND schema_version = %d AND observed_at = %s LIMIT 1',
				Npcink_Device_Inventory_V3_Tables::observations(),
				$asset_id,
				$source,
				$schema_version,
				$observed_at
			)
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		return !empty($found);
	}

	private function sync_latest_observation_columns()
	{
		global $wpdb;
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Restore rebuilds denormalized latest observation metadata inside the same transaction.
		$result = $wpdb->query(
			$wpdb->prepare(
				"UPDATE %i a
				SET
					a.updated_at = a.updated_at,
					a.latest_observation_id = (
						SELECT o.id
						FROM %i o
						WHERE o.asset_id = a.id
						ORDER BY o.observed_at DESC, o.id DESC
						LIMIT 1
					),
					a.latest_observed_at = (
						SELECT o.observed_at
						FROM %i o
						WHERE o.asset_id = a.id
						ORDER BY o.observed_at DESC, o.id DESC
						LIMIT 1
					)",
				Npcink_Device_Inventory_V3_Tables::assets(),
				Npcink_Device_Inventory_V3_Tables::observations(),
				Npcink_Device_Inventory_V3_Tables::observations()
			)
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		if ($result === false) {
			throw new Exception('Failed to rebuild latest observation metadata during backup restore.');
		}
	}

	private function event_exists($asset_id, $source, $type, $message, $created_at)
	{
		global $wpdb;
		$asset_id = $asset_id ? intval($asset_id) : 0;
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned restore lookup.
		$found = $asset_id
			? $wpdb->get_var(
				$wpdb->prepare(
					'SELECT id FROM %i WHERE asset_id = %d AND event_source = %s AND event_type = %s AND message = %s AND created_at = %s LIMIT 1',
					Npcink_Device_Inventory_V3_Tables::events(),
					$asset_id,
					$source,
					$type,
					$message,
					$created_at
				)
			)
			: $wpdb->get_var(
				$wpdb->prepare(
					'SELECT id FROM %i WHERE asset_id IS NULL AND event_source = %s AND event_type = %s AND message = %s AND created_at = %s LIMIT 1',
					Npcink_Device_Inventory_V3_Tables::events(),
					$source,
					$type,
					$message,
					$created_at
				)
			);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		return !empty($found);
	}

	private function safe_json_field($item, $key)
	{
		return Npcink_Device_Inventory_V3_Sanitizer::json_encode(isset($item[$key]) && is_array($item[$key]) ? $item[$key] : array());
	}

	private function backup_text($item, $keys, $mode = 'text', $fallback = '')
	{
		foreach ($keys as $key) {
			if (!array_key_exists($key, $item) || $item[$key] === null) {
				continue;
			}
			$value = is_scalar($item[$key]) ? (string) $item[$key] : '';
			if ($value === '') {
				continue;
			}
			if ($mode === 'key') {
				return sanitize_key($value);
			}
			if ($mode === 'textarea') {
				return sanitize_textarea_field($value);
			}
			return sanitize_text_field($value);
		}
		return $fallback;
	}

	private function backup_datetime($item, $key, $required)
	{
		if (!isset($item[$key]) || !is_scalar($item[$key])) {
			return $required ? '' : current_time('mysql');
		}
		$value = sanitize_text_field((string) $item[$key]);
		$timestamp = strtotime($value);
		if (!$timestamp) {
			return $required ? '' : current_time('mysql');
		}
		return gmdate('Y-m-d H:i:s', $timestamp);
	}

	private function count_backup_identities($groups)
	{
		$count = 0;
		foreach ($groups as $group) {
			if (is_array($group) && isset($group['identities']) && is_array($group['identities'])) {
				$count += count($group['identities']);
			} else {
				$count++;
			}
		}
		return $count;
	}

	private function generate_unique_asset_uuid()
	{
		for ($attempt = 0; $attempt < 5; $attempt++) {
			$uuid = wp_generate_uuid4();
			if (!$this->find_asset_by_uuid($uuid)) {
				return $uuid;
			}
		}
		throw new Exception('Failed to generate unique asset UUID.');
	}

	private function add_warning(&$summary, $message)
	{
		if (!in_array($message, $summary['warnings'], true)) {
			$summary['warnings'][] = $message;
		}
	}

	private function assert_no_import_conflicts($summary)
	{
		if (!empty($summary['conflicts'])) {
			// phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- Summary is structured REST error data, not HTML output.
			throw new Npcink_Device_Inventory_Backup_Restore_Conflict_Exception($summary);
		}
	}

	private function empty_asset_map()
	{
		return array(
			'by_old_id' => array(),
			'by_uuid' => array(),
			'by_number' => array(),
		);
	}

	private function bump_cache_versions()
	{
		foreach (array('npcink_device_inventory_assets', 'npcink_device_inventory_identities', 'npcink_device_inventory_observations', 'npcink_device_inventory_events') as $group) {
			$version = wp_cache_get('list_version', $group);
			wp_cache_set('list_version', intval($version) + 1, $group);
		}
	}
}
