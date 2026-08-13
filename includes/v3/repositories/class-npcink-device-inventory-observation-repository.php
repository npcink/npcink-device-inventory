<?php

if (!defined('ABSPATH')) {
	exit;
}

class Npcink_Device_Inventory_Observation_Repository
{
	const CACHE_GROUP = 'npcink_device_inventory_observations';
	const CACHE_TTL = 60;

	public function create($asset_id, $observation)
	{
		global $wpdb;
		$row = array(
			'asset_id' => intval($asset_id),
			'source' => sanitize_key($observation['source']),
			'schema_version' => intval($observation['schema_version']),
			'observed_at' => sanitize_text_field($observation['observed_at']),
			'summary_json' => Npcink_Device_Inventory_V3_Sanitizer::json_encode($observation['summary']),
			'hardware_json' => Npcink_Device_Inventory_V3_Sanitizer::json_encode($observation['hardware']),
			'raw_json' => Npcink_Device_Inventory_V3_Sanitizer::json_encode($observation['raw']),
		);

		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned observation table write invalidates repository object-cache version after success.
		$result = $wpdb->insert(
			Npcink_Device_Inventory_V3_Tables::observations(),
			$row,
			array('%d', '%s', '%d', '%s', '%s', '%s', '%s')
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		if ($result === false) {
			return null;
		}
		$this->update_asset_latest_observation(intval($asset_id), intval($wpdb->insert_id), (string) $row['observed_at']);
		$this->bump_list_cache_version();
		return $this->find_by_id($wpdb->insert_id);
	}

	/**
	 * Move subsequent reads past observations cached by a rolled-back ingest.
	 */
	public function invalidate_cache()
	{
		$this->bump_list_cache_version();
	}

	public function delete_older_than($cutoff)
	{
		global $wpdb;
		$cutoff = sanitize_text_field((string) $cutoff);
		if ($cutoff === '') {
			return 0;
		}
		$observations = Npcink_Device_Inventory_V3_Tables::observations();
		$assets = Npcink_Device_Inventory_V3_Tables::assets();
		// Keep each asset's current snapshot even when it is older than the retention window.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Bounded maintenance write against plugin-owned tables.
		$deleted = $wpdb->query(
			$wpdb->prepare(
				'DELETE o FROM %i o LEFT JOIN %i a ON a.latest_observation_id = o.id WHERE o.observed_at < %s AND a.id IS NULL',
				$observations,
				$assets,
				$cutoff
			)
		);
		if ($deleted === false) {
			return false;
		}
		if ($deleted > 0) {
			$this->invalidate_cache();
		}
		return intval($deleted);
	}

	private function update_asset_latest_observation($asset_id, $observation_id, $observed_at)
	{
		global $wpdb;
		if (!$this->assets_support_latest_observation_columns()) {
			return;
		}

		$assets_table = Npcink_Device_Inventory_V3_Tables::assets();
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Observation ingest denormalizes latest observation metadata onto the plugin-owned asset row.
		$updated = $wpdb->query(
			$wpdb->prepare(
				"UPDATE %i
				SET updated_at = updated_at, latest_observation_id = %d, latest_observed_at = %s
				WHERE id = %d
				AND (
					latest_observed_at IS NULL
					OR latest_observed_at < %s
					OR (latest_observed_at = %s AND (latest_observation_id IS NULL OR latest_observation_id < %d))
				)",
				$assets_table,
				$observation_id,
				$observed_at,
				$asset_id,
				$observed_at,
				$observed_at,
				$observation_id
			)
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		if ($updated !== false && class_exists('Npcink_Device_Inventory_Asset_Repository')) {
			$version = wp_cache_get('list_version', Npcink_Device_Inventory_Asset_Repository::CACHE_GROUP);
			wp_cache_set('list_version', intval($version === false ? 1 : $version) + 1, Npcink_Device_Inventory_Asset_Repository::CACHE_GROUP);
		}
	}

	private function assets_support_latest_observation_columns()
	{
		static $supported = null;
		if ($supported !== null) {
			return $supported;
		}

		global $wpdb;
		$table = Npcink_Device_Inventory_V3_Tables::assets();
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Schema guard prevents upload failures during rolling upgrades.
		$count = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME IN (%s, %s)',
				$table,
				'latest_observation_id',
				'latest_observed_at'
			)
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		$supported = intval($count) === 2;
		return $supported;
	}

	public function find_by_id($id)
	{
		global $wpdb;
		$id = intval($id);
		$cache_key = 'observation:' . $id;
		$cached = wp_cache_get($cache_key, self::CACHE_GROUP);
		if ($cached !== false) {
			return $cached;
		}

		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery -- Plugin-owned observation table query is wrapped in the object cache.
		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d',
				Npcink_Device_Inventory_V3_Tables::observations(),
				$id
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery

		wp_cache_set($cache_key, $row, self::CACHE_GROUP, self::CACHE_TTL);
		return $row;
	}

	public function list_for_asset($asset_id, $page, $page_size)
	{
		global $wpdb;
		$asset_id = intval($asset_id);
		$page = max(1, intval($page));
		$page_size = max(1, min(100, intval($page_size)));
		$offset = ($page - 1) * $page_size;
		$cache_key = $this->build_cache_key(
			'asset-list',
			array(
				'asset_id' => $asset_id,
				'page' => $page,
				'page_size' => $page_size,
				'version' => $this->get_list_cache_version(),
			)
		);
		$cached = wp_cache_get($cache_key, self::CACHE_GROUP);
		if ($cached !== false) {
			return $cached;
		}

		$table = Npcink_Device_Inventory_V3_Tables::observations();
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery -- Plugin-owned observation table queries are wrapped in the object cache.
		$total = $wpdb->get_var($wpdb->prepare('SELECT COUNT(*) FROM %i WHERE asset_id = %d', $table, $asset_id));
		$items = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE asset_id = %d ORDER BY observed_at DESC, id DESC LIMIT %d OFFSET %d',
				$table,
				$asset_id,
				$page_size,
				$offset
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery

		$result = array('items' => $items ?: array(), 'total' => intval($total), 'page' => $page, 'pageSize' => $page_size);
		wp_cache_set($cache_key, $result, self::CACHE_GROUP, self::CACHE_TTL);
		return $result;
	}

	public function list_all($args)
	{
		global $wpdb;
		$page = max(1, intval($args['page']));
		$page_size = max(1, min(100, intval($args['pageSize'])));
		$offset = ($page - 1) * $page_size;
		$observations_table = Npcink_Device_Inventory_V3_Tables::observations();
		$assets_table = Npcink_Device_Inventory_V3_Tables::assets();
		$source = isset($args['source']) ? sanitize_key($args['source']) : '';
		$search = isset($args['search']) ? sanitize_text_field($args['search']) : '';
		$cache_key = $this->build_cache_key(
			'all-list',
			array(
				'source' => $source,
				'search' => $search,
				'page' => $page,
				'page_size' => $page_size,
				'version' => $this->get_list_cache_version(),
			)
		);
		$cached = wp_cache_get($cache_key, self::CACHE_GROUP);
		if ($cached !== false) {
			return $cached;
		}

		$like = '%' . $wpdb->esc_like($search) . '%';
		if ($source !== '' && $search !== '') {
			// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery -- Plugin-owned observation table queries are wrapped in the object cache.
			$total = $wpdb->get_var(
				$wpdb->prepare(
					'SELECT COUNT(*) FROM %i o INNER JOIN %i a ON a.id = o.asset_id WHERE a.status <> \'deleted\' AND o.source = %s AND (a.asset_number LIKE %s OR a.name LIKE %s OR a.department LIKE %s OR o.summary_json LIKE %s)',
					$observations_table,
					$assets_table,
					$source,
					$like,
					$like,
					$like,
					$like
				)
			);
			$items = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT o.*, a.uuid AS asset_uuid, a.asset_number, a.name AS asset_name, a.asset_type, a.status, a.department, a.owner_name
					FROM %i o
					INNER JOIN %i a ON a.id = o.asset_id
					WHERE a.status <> 'deleted' AND o.source = %s AND (a.asset_number LIKE %s OR a.name LIKE %s OR a.department LIKE %s OR o.summary_json LIKE %s)
					ORDER BY o.observed_at DESC, o.id DESC
					LIMIT %d OFFSET %d",
					$observations_table,
					$assets_table,
					$source,
					$like,
					$like,
					$like,
					$like,
					$page_size,
					$offset
				),
				ARRAY_A
			);
			// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery
		} elseif ($source !== '') {
			// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery -- Plugin-owned observation table queries are wrapped in the object cache.
			$total = $wpdb->get_var(
				$wpdb->prepare(
					'SELECT COUNT(*) FROM %i o INNER JOIN %i a ON a.id = o.asset_id WHERE a.status <> \'deleted\' AND o.source = %s',
					$observations_table,
					$assets_table,
					$source
				)
			);
			$items = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT o.*, a.uuid AS asset_uuid, a.asset_number, a.name AS asset_name, a.asset_type, a.status, a.department, a.owner_name
					FROM %i o
					INNER JOIN %i a ON a.id = o.asset_id
					WHERE a.status <> 'deleted' AND o.source = %s
					ORDER BY o.observed_at DESC, o.id DESC
					LIMIT %d OFFSET %d",
					$observations_table,
					$assets_table,
					$source,
					$page_size,
					$offset
				),
				ARRAY_A
			);
			// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery
		} elseif ($search !== '') {
			// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery -- Plugin-owned observation table queries are wrapped in the object cache.
			$total = $wpdb->get_var(
				$wpdb->prepare(
					'SELECT COUNT(*) FROM %i o INNER JOIN %i a ON a.id = o.asset_id WHERE a.status <> \'deleted\' AND (a.asset_number LIKE %s OR a.name LIKE %s OR a.department LIKE %s OR o.summary_json LIKE %s)',
					$observations_table,
					$assets_table,
					$like,
					$like,
					$like,
					$like
				)
			);
			$items = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT o.*, a.uuid AS asset_uuid, a.asset_number, a.name AS asset_name, a.asset_type, a.status, a.department, a.owner_name
					FROM %i o
					INNER JOIN %i a ON a.id = o.asset_id
					WHERE a.status <> 'deleted' AND (a.asset_number LIKE %s OR a.name LIKE %s OR a.department LIKE %s OR o.summary_json LIKE %s)
					ORDER BY o.observed_at DESC, o.id DESC
					LIMIT %d OFFSET %d",
					$observations_table,
					$assets_table,
					$like,
					$like,
					$like,
					$like,
					$page_size,
					$offset
				),
				ARRAY_A
			);
			// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery
		} else {
			// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery -- Plugin-owned observation table queries are wrapped in the object cache.
			$total = $wpdb->get_var(
				$wpdb->prepare(
					'SELECT COUNT(*) FROM %i o INNER JOIN %i a ON a.id = o.asset_id WHERE a.status <> \'deleted\'',
					$observations_table,
					$assets_table
				)
			);
			$items = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT o.*, a.uuid AS asset_uuid, a.asset_number, a.name AS asset_name, a.asset_type, a.status, a.department, a.owner_name
					FROM %i o
					INNER JOIN %i a ON a.id = o.asset_id
					WHERE a.status <> 'deleted'
					ORDER BY o.observed_at DESC, o.id DESC
					LIMIT %d OFFSET %d",
					$observations_table,
					$assets_table,
					$page_size,
					$offset
				),
				ARRAY_A
			);
			// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery
		}

		$result = array('items' => $items ?: array(), 'total' => intval($total), 'page' => $page, 'pageSize' => $page_size);
		wp_cache_set($cache_key, $result, self::CACHE_GROUP, self::CACHE_TTL);
		return $result;
	}

	public function daily_counts_between($start_at, $end_at)
	{
		global $wpdb;
		$start_at = sanitize_text_field((string) $start_at);
		$end_at = sanitize_text_field((string) $end_at);
		$cache_key = $this->build_cache_key(
			'daily-counts',
			array(
				'start_at' => $start_at,
				'end_at' => $end_at,
				'version' => $this->get_list_cache_version(),
			)
		);
		$cached = wp_cache_get($cache_key, self::CACHE_GROUP);
		if ($cached !== false) {
			return $cached;
		}

		$observations_table = Npcink_Device_Inventory_V3_Tables::observations();
		$assets_table = Npcink_Device_Inventory_V3_Tables::assets();
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery -- Plugin-owned aggregate is bounded to the requested date range and cached.
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT DATE(o.observed_at) AS day, COUNT(*) AS count
				FROM %i o
				INNER JOIN %i a ON a.id = o.asset_id
				WHERE a.status <> 'deleted' AND o.observed_at >= %s AND o.observed_at < %s
				GROUP BY DATE(o.observed_at)
				ORDER BY day ASC",
				$observations_table,
				$assets_table,
				$start_at,
				$end_at
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery

		$result = $rows ?: array();
		wp_cache_set($cache_key, $result, self::CACHE_GROUP, self::CACHE_TTL);
		return $result;
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

	private function bump_list_cache_version()
	{
		$version = $this->get_list_cache_version();
		wp_cache_set('list_version', $version + 1, self::CACHE_GROUP);
	}
}
