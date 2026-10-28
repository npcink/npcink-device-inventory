<?php

if (!defined('ABSPATH')) {
	exit;
}

class Npcink_Device_Inventory_Event_Repository
{
	const CACHE_GROUP = 'npcink_device_inventory_events';
	const CACHE_TTL = 60;

	public function create($asset_id, $event)
	{
		global $wpdb;
		$row = array(
			'asset_id' => $asset_id ? intval($asset_id) : null,
			'event_source' => sanitize_key($event['event_source']),
			'event_type' => sanitize_key($event['event_type']),
			'field_name' => isset($event['field_name']) ? sanitize_text_field($event['field_name']) : null,
			'old_value' => isset($event['old_value']) ? sanitize_textarea_field((string) $event['old_value']) : null,
			'new_value' => isset($event['new_value']) ? sanitize_textarea_field((string) $event['new_value']) : null,
			'message' => isset($event['message']) ? sanitize_textarea_field($event['message']) : null,
			'actor_user_id' => isset($event['actor_user_id']) ? intval($event['actor_user_id']) : null,
			'actor_name' => isset($event['actor_name']) ? sanitize_text_field($event['actor_name']) : '',
			'payload_json' => isset($event['payload']) ? Npcink_Device_Inventory_V3_Sanitizer::json_encode($event['payload']) : null,
		);

		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned event table write invalidates repository object-cache version after success.
		$result = $wpdb->insert(
			Npcink_Device_Inventory_V3_Tables::events(),
			$row,
			array('%d', '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s')
		) !== false;
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching
		if ($result) {
			$this->bump_list_cache_version();
		}
		return $result;
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

		$table = Npcink_Device_Inventory_V3_Tables::events();
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery -- Plugin-owned event table queries are wrapped in the object cache.
		$total = $wpdb->get_var($wpdb->prepare('SELECT COUNT(*) FROM %i WHERE asset_id = %d', $table, $asset_id));
		$items = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE asset_id = %d ORDER BY created_at DESC, id DESC LIMIT %d OFFSET %d',
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
		$events_table = Npcink_Device_Inventory_V3_Tables::events();
		$assets_table = Npcink_Device_Inventory_V3_Tables::assets();
		$event_mode = isset($args['event_mode']) ? sanitize_key($args['event_mode']) : '';
		if ($event_mode !== 'manual' && $event_mode !== 'auto') {
			$event_mode = '';
		}
		$event_source = isset($args['event_source']) ? sanitize_key($args['event_source']) : '';
		$event_type = isset($args['event_type']) ? sanitize_key($args['event_type']) : '';
		$search = isset($args['search']) ? sanitize_text_field($args['search']) : '';
		$like = '%' . $wpdb->esc_like($search) . '%';
		$cache_key = $this->build_cache_key(
			'all-list',
			array(
				'event_mode' => $event_mode,
				'event_source' => $event_source,
				'event_type' => $event_type,
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

		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery -- Plugin-owned event table queries are wrapped in the object cache.
		$total = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM %i e
				LEFT JOIN %i a ON a.id = e.asset_id
				WHERE (%s = '' OR (%s = 'manual' AND e.event_source = 'manual') OR (%s = 'auto' AND e.event_source IN ('upload', 'system', 'import')))
				AND (%s = '' OR e.event_source = %s)
				AND (%s = '' OR e.event_type = %s)
				AND (%s = '' OR e.message LIKE %s OR e.field_name LIKE %s OR a.asset_number LIKE %s OR a.name LIKE %s)",
				$events_table,
				$assets_table,
				$event_mode,
				$event_mode,
				$event_mode,
				$event_source,
				$event_source,
				$event_type,
				$event_type,
				$search,
				$like,
				$like,
				$like,
				$like
			)
		);
		$items = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT e.*, a.uuid AS asset_uuid, a.asset_number, a.name AS asset_name, a.asset_type, a.status, a.department, a.owner_name
			FROM %i e
			LEFT JOIN %i a ON a.id = e.asset_id
			WHERE (%s = '' OR (%s = 'manual' AND e.event_source = 'manual') OR (%s = 'auto' AND e.event_source IN ('upload', 'system', 'import')))
			AND (%s = '' OR e.event_source = %s)
			AND (%s = '' OR e.event_type = %s)
			AND (%s = '' OR e.message LIKE %s OR e.field_name LIKE %s OR a.asset_number LIKE %s OR a.name LIKE %s)
			ORDER BY e.created_at DESC, e.id DESC
			LIMIT %d OFFSET %d",
				$events_table,
				$assets_table,
				$event_mode,
				$event_mode,
				$event_mode,
				$event_source,
				$event_source,
				$event_type,
				$event_type,
				$search,
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

		$result = array('items' => $items ?: array(), 'total' => intval($total), 'page' => $page, 'pageSize' => $page_size);
		wp_cache_set($cache_key, $result, self::CACHE_GROUP, self::CACHE_TTL);
		return $result;
	}

	/** Invalidate reads populated before a transaction committed or rolled back. */
	public function invalidate_cache()
	{
		$this->bump_list_cache_version();
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
