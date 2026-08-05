<?php

if (!defined('ABSPATH')) {
	exit;
}

class Npcink_Device_Inventory_Asset_Repository
{
	const CACHE_GROUP = 'npcink_device_inventory_assets';
	const CACHE_TTL = 60;
	private $last_write_error = '';

	public function find_by_uuid($uuid)
	{
		global $wpdb;
		$uuid = sanitize_text_field($uuid);
		$cache_key = $this->build_cache_key(
			'uuid',
			array(
				'uuid' => $uuid,
				'version' => $this->get_list_cache_version(),
			)
		);
		$cached = wp_cache_get($cache_key, self::CACHE_GROUP);
		if ($cached !== false) {
			return $cached;
		}

		$assets_table = Npcink_Device_Inventory_V3_Tables::assets();
		$observations_table = Npcink_Device_Inventory_V3_Tables::observations();
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery -- Plugin-owned asset table query is wrapped in the object cache.
		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT a.*,
					lo.summary_json AS latest_summary_json,
					lo.hardware_json AS latest_hardware_json,
					lo.observed_at AS latest_observed_at,
					lo.source AS latest_observation_source
				FROM %i a
				LEFT JOIN %i lo ON lo.id = a.latest_observation_id
				WHERE a.uuid = %s",
				$assets_table,
				$observations_table,
				$uuid
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery
		wp_cache_set($cache_key, $row, self::CACHE_GROUP, self::CACHE_TTL);
		return $row;
	}

	public function find_by_id($id)
	{
		global $wpdb;
		$id = intval($id);
		$cache_key = $this->build_cache_key(
			'id',
			array(
				'id' => $id,
				'version' => $this->get_list_cache_version(),
			)
		);
		$cached = wp_cache_get($cache_key, self::CACHE_GROUP);
		if ($cached !== false) {
			return $cached;
		}

		$assets_table = Npcink_Device_Inventory_V3_Tables::assets();
		$observations_table = Npcink_Device_Inventory_V3_Tables::observations();
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery -- Plugin-owned asset table query is wrapped in the object cache.
		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT a.*,
					lo.summary_json AS latest_summary_json,
					lo.hardware_json AS latest_hardware_json,
					lo.observed_at AS latest_observed_at,
					lo.source AS latest_observation_source
				FROM %i a
				LEFT JOIN %i lo ON lo.id = a.latest_observation_id
				WHERE a.id = %d",
				$assets_table,
				$observations_table,
				$id
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery
		wp_cache_set($cache_key, $row, self::CACHE_GROUP, self::CACHE_TTL);
		return $row;
	}

	public function find_by_asset_number($asset_number)
	{
		global $wpdb;
		$asset_number = sanitize_text_field($asset_number);
		if ($asset_number === '') {
			return null;
		}

		$cache_key = $this->build_cache_key(
			'asset_number',
			array(
				'asset_number' => $asset_number,
				'version' => $this->get_list_cache_version(),
			)
		);
		$cached = wp_cache_get($cache_key, self::CACHE_GROUP);
		if ($cached !== false) {
			return $cached;
		}

		// Archived rows intentionally retain their asset numbers, so this lookup must not filter by status.
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery -- Plugin-owned asset table query is wrapped in the object cache.
		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT id, uuid, asset_number, status FROM %i WHERE asset_number = %s LIMIT 1',
				Npcink_Device_Inventory_V3_Tables::assets(),
				$asset_number
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery
		wp_cache_set($cache_key, $row, self::CACHE_GROUP, self::CACHE_TTL);
		return $row;
	}

	public function list_assets($args)
	{
		global $wpdb;
		$page = max(1, intval($args['page']));
		$page_size = max(1, min(100, intval($args['pageSize'])));
		$offset = ($page - 1) * $page_size;
		$cache_key = $this->build_cache_key(
			'list',
			array(
				'args' => $this->sanitize_list_cache_args($args),
				'page' => $page,
				'page_size' => $page_size,
				'version' => $this->get_list_cache_version(),
			)
		);
		$cached = wp_cache_get($cache_key, self::CACHE_GROUP);
		if ($cached !== false) {
			return $cached;
		}

		$asset_type = isset($args['asset_type']) ? sanitize_text_field($args['asset_type']) : '';
		$status = isset($args['status']) ? sanitize_text_field($args['status']) : '';
		$include_deleted = !empty($args['include_deleted']) || $status === 'deleted' ? '1' : '';
		$department = isset($args['department']) ? sanitize_text_field($args['department']) : '';
		$category = isset($args['category']) ? sanitize_text_field($args['category']) : '';
		$asset_scope = isset($args['asset_scope']) ? sanitize_key($args['asset_scope']) : '';
		if ($asset_scope !== 'computer' && $asset_scope !== 'other') {
			$asset_scope = '';
		}
		$sort_by = isset($args['sort_by']) ? sanitize_key($args['sort_by']) : '';
		$search = isset($args['search']) ? sanitize_text_field($args['search']) : '';
		$like = '%' . $wpdb->esc_like($search) . '%';
		$prefix_like = $wpdb->esc_like($search) . '%';
		$extended_search = $this->should_search_extended_asset_data($search) ? '1' : '';
		$extended_like = $extended_search === '1' ? $like : '__npcink_no_extended_asset_match__';
		$extended_prefix_like = $extended_search === '1' ? $prefix_like : '__npcink_no_extended_asset_match__';
		$primary_ip_exact_like = '%"primary_ip":"' . $wpdb->esc_like($search) . '"%';
		$primary_ip_prefix_like = $extended_search === '1' ? '%"primary_ip":"' . $wpdb->esc_like($search) . '%' : '__npcink_no_extended_asset_match__';
		$platform_regex = $this->build_platform_regex(isset($args['purchase_platform']) ? $args['purchase_platform'] : '');
		$platform_filter = $platform_regex === '' ? '' : '1';
		$platform_query_regex = $platform_regex === '' ? 'a^' : $platform_regex;
		$table = Npcink_Device_Inventory_V3_Tables::assets();
		$identities_table = Npcink_Device_Inventory_V3_Tables::identities();
		$observations_table = Npcink_Device_Inventory_V3_Tables::observations();
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery -- Plugin-owned asset table query is wrapped in the object cache.
		$total = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM %i a
				WHERE (%s = '' OR a.asset_type = %s)
				AND (%s = '' OR a.status = %s)
				AND (%s = '1' OR a.status <> 'deleted')
				AND (%s = '' OR a.department = %s)
				AND (%s = '' OR a.category = %s)
				AND (%s = '' OR (%s = 'computer' AND a.asset_type = 'computer') OR (%s = 'other' AND a.asset_type = 'custom'))
				AND (
					%s = ''
					OR a.asset_number LIKE %s
					OR a.name LIKE %s
					OR a.owner_name LIKE %s
					OR a.department LIKE %s
					OR (%s = '1' AND a.metadata_json LIKE %s)
					OR (%s = '1' AND EXISTS (
						SELECT 1
						FROM %i si
						WHERE si.asset_id = a.id
						AND si.identity_type IN ('system_uuid_v2', 'baseboard_serial_v2', 'pci_permanent_mac_v2', 'device_uuid_v1', 'fallback_device_v1')
						AND si.identity_value LIKE %s
					))
					OR (%s = '1' AND EXISTS (
						SELECT 1
						FROM %i so
						WHERE so.asset_id = a.id
						AND so.summary_json LIKE %s
					))
				)
				AND (%s = '' OR a.metadata_json REGEXP %s)",
				$table,
				$asset_type,
				$asset_type,
				$status,
				$status,
				$include_deleted,
				$department,
				$department,
				$category,
				$category,
				$asset_scope,
				$asset_scope,
				$asset_scope,
				$search,
				$like,
				$like,
				$like,
				$like,
				$extended_search,
				$extended_like,
				$extended_search,
				$identities_table,
				$extended_like,
				$extended_search,
				$observations_table,
				$extended_like,
				$platform_filter,
				$platform_query_regex
			)
		);

		$items = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT a.*,
				lo.summary_json AS latest_summary_json,
				lo.hardware_json AS latest_hardware_json,
				lo.observed_at AS latest_observed_at,
				lo.source AS latest_observation_source
			FROM %i a
			LEFT JOIN %i lo ON lo.id = a.latest_observation_id
			WHERE (%s = '' OR a.asset_type = %s)
			AND (%s = '' OR a.status = %s)
			AND (%s = '1' OR a.status <> 'deleted')
			AND (%s = '' OR a.department = %s)
			AND (%s = '' OR a.category = %s)
			AND (%s = '' OR (%s = 'computer' AND a.asset_type = 'computer') OR (%s = 'other' AND a.asset_type = 'custom'))
			AND (
				%s = ''
				OR a.asset_number LIKE %s
				OR a.name LIKE %s
				OR a.owner_name LIKE %s
				OR a.department LIKE %s
				OR (%s = '1' AND a.metadata_json LIKE %s)
				OR (%s = '1' AND EXISTS (
					SELECT 1
					FROM %i si
					WHERE si.asset_id = a.id
					AND si.identity_type IN ('system_uuid_v2', 'baseboard_serial_v2', 'pci_permanent_mac_v2', 'device_uuid_v1', 'fallback_device_v1')
					AND si.identity_value LIKE %s
				))
				OR (%s = '1' AND EXISTS (
					SELECT 1
					FROM %i so
					WHERE so.asset_id = a.id
					AND so.summary_json LIKE %s
				))
			)
			AND (%s = '' OR a.metadata_json REGEXP %s)
			ORDER BY
				CASE
					WHEN %s = '' THEN 0
					WHEN a.asset_number = %s THEN 0
					WHEN a.name = %s THEN 1
					WHEN a.owner_name = %s THEN 2
					WHEN a.department = %s THEN 3
					WHEN EXISTS (
						SELECT 1
						FROM %i oi
						WHERE oi.asset_id = a.id
						AND oi.identity_type IN ('system_uuid_v2', 'baseboard_serial_v2', 'pci_permanent_mac_v2', 'device_uuid_v1', 'fallback_device_v1')
						AND oi.identity_value = %s
					) THEN 4
					WHEN %s = '1' AND lo.summary_json LIKE %s THEN 5
					WHEN a.asset_number LIKE %s THEN 6
					WHEN a.name LIKE %s THEN 7
					WHEN a.owner_name LIKE %s THEN 8
					WHEN a.department LIKE %s THEN 9
					WHEN %s = '1' AND EXISTS (
						SELECT 1
						FROM %i pi
						WHERE pi.asset_id = a.id
						AND pi.identity_type IN ('system_uuid_v2', 'baseboard_serial_v2', 'pci_permanent_mac_v2', 'device_uuid_v1', 'fallback_device_v1')
						AND pi.identity_value LIKE %s
					) THEN 10
					WHEN %s = '1' AND lo.summary_json LIKE %s THEN 11
					WHEN %s = '1' AND a.metadata_json LIKE %s THEN 12
					ELSE 13
					END ASC,
					CASE WHEN %s IN ('latest_upload', 'latestupload', 'latest_observed', 'latestobserved') THEN COALESCE(a.latest_observed_at, a.updated_at, a.created_at) END DESC,
					CASE WHEN %s IN ('latest_upload', 'latestupload', 'latest_observed', 'latestobserved') THEN a.updated_at END DESC,
					CASE WHEN %s NOT IN ('latest_upload', 'latestupload', 'latest_observed', 'latestobserved') THEN a.updated_at END DESC,
					a.id DESC
				LIMIT %d OFFSET %d",
				$table,
				$observations_table,
				$asset_type,
				$asset_type,
				$status,
				$status,
				$include_deleted,
				$department,
				$department,
				$category,
				$category,
				$asset_scope,
				$asset_scope,
				$asset_scope,
				$search,
				$like,
				$like,
				$like,
				$like,
				$extended_search,
				$extended_like,
				$extended_search,
				$identities_table,
				$extended_like,
				$extended_search,
				$observations_table,
				$extended_like,
				$platform_filter,
				$platform_query_regex,
				$search,
				$search,
				$search,
				$search,
				$search,
				$identities_table,
				$search,
				$extended_search,
				$primary_ip_exact_like,
				$prefix_like,
				$prefix_like,
				$prefix_like,
				$prefix_like,
				$extended_search,
				$identities_table,
				$extended_prefix_like,
				$extended_search,
				$primary_ip_prefix_like,
				$extended_search,
				$extended_like,
				$sort_by,
				$sort_by,
				$sort_by,
				$page_size,
				$offset
				),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery

		$result = array(
			'items' => $items ?: array(),
			'total' => intval($total),
			'page' => $page,
			'pageSize' => $page_size,
		);
		wp_cache_set($cache_key, $result, self::CACHE_GROUP, self::CACHE_TTL);
		return $result;
	}

	public function create($data)
	{
		global $wpdb;
		$uuid = !empty($data['uuid']) ? sanitize_text_field($data['uuid']) : wp_generate_uuid4();
		$asset_number = !empty($data['asset_number']) ? sanitize_text_field($data['asset_number']) : $this->next_asset_number();
		$row = array(
			'uuid' => $uuid,
			'asset_type' => sanitize_key($data['asset_type']),
			'asset_number' => $asset_number,
			'name' => sanitize_text_field($data['name']),
			'owner_name' => sanitize_text_field($data['owner_name']),
			'department' => Npcink_Device_Inventory_V3_Tables::normalize_department($data['department']),
			'status' => sanitize_key($data['status']),
			'category' => sanitize_text_field($data['category']),
			'purchase_price' => floatval($data['purchase_price']),
			'residual_value' => floatval($data['residual_value']),
			'metadata_json' => Npcink_Device_Inventory_V3_Sanitizer::json_encode($data['metadata']),
		);

		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned asset table write invalidates repository object-cache version after success.
		$result = $wpdb->insert(
			Npcink_Device_Inventory_V3_Tables::assets(),
			$row,
			array('%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%f', '%f', '%s')
		);
		$this->last_write_error = $result === false ? (string) $wpdb->last_error : '';
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching

		if ($result === false) {
			return null;
		}
		$version = $this->get_list_cache_version();
		wp_cache_set('list_version', $version + 1, self::CACHE_GROUP);
		return $this->find_by_id($wpdb->insert_id);
	}

	public function update($uuid, $data)
	{
		global $wpdb;
		$allowed = array(
			'asset_type' => '%s',
			'asset_number' => '%s',
			'name' => '%s',
			'owner_name' => '%s',
			'department' => '%s',
			'status' => '%s',
			'category' => '%s',
			'purchase_price' => '%f',
			'residual_value' => '%f',
			'metadata_json' => '%s',
		);
		$row = array();
		$formats = array();

		foreach ($allowed as $field => $format) {
			if (!array_key_exists($field, $data)) {
				continue;
			}
			$value = $data[$field];
			if ($field === 'metadata_json' && is_array($value)) {
				$value = Npcink_Device_Inventory_V3_Sanitizer::json_encode($value);
			} elseif ($field === 'department') {
				$value = Npcink_Device_Inventory_V3_Tables::normalize_department($value);
			} elseif ($format === '%s') {
				$value = sanitize_text_field($value);
			} elseif ($format === '%f') {
				$value = floatval($value);
			}
			$row[$field] = $value;
			$formats[] = $format;
		}

		if (empty($row)) {
			return $this->find_by_uuid($uuid);
		}

		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Plugin-owned asset table write invalidates repository object-cache version after success.
		$result = $wpdb->update(
			Npcink_Device_Inventory_V3_Tables::assets(),
			$row,
			array('uuid' => $uuid),
			$formats,
			array('%s')
		);
		$this->last_write_error = $result === false ? (string) $wpdb->last_error : '';
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching

		if ($result === false) {
			return null;
		}
		$version = $this->get_list_cache_version();
		wp_cache_set('list_version', $version + 1, self::CACHE_GROUP);
		return $this->find_by_uuid($uuid);
	}

	public function last_write_was_duplicate_asset_number()
	{
		return stripos($this->last_write_error, 'Duplicate entry') !== false
			&& stripos($this->last_write_error, 'asset_number') !== false;
	}

	/**
	 * Move subsequent reads past any rows cached by a rolled-back transaction.
	 */
	public function invalidate_cache()
	{
		$version = $this->get_list_cache_version();
		wp_cache_set('list_version', $version + 1, self::CACHE_GROUP);
	}

	private function next_asset_number()
	{
		$options = Npcink_Device_Inventory_V3_Tables::options();
		$prefix = preg_replace('/[^A-Za-z0-9_-]/', '', (string) $options['asset_number_prefix']);
		if ($prefix === '') {
			$prefix = 'A';
		}
		return $prefix . gmdate('ymdHis') . wp_rand(100, 999);
	}

	private function build_cache_key($prefix, $parts)
	{
		$encoded = wp_json_encode($parts);
		return $prefix . ':' . md5(is_string($encoded) ? $encoded : serialize($parts));
	}

	private function build_platform_regex($value)
	{
		$platforms = array_filter(
			array_map('sanitize_text_field', explode('|', (string) $value))
		);
		if (empty($platforms)) {
			return '';
		}
		$escaped = array_map(
			function ($platform) {
				return preg_quote($platform, '/');
			},
			$platforms
		);
		return implode('|', $escaped);
	}

	private function sanitize_list_cache_args($args)
	{
		$result = array();
		foreach (array('asset_type', 'status', 'department', 'category', 'asset_scope', 'search', 'purchase_platform', 'sort_by', 'include_deleted') as $field) {
			$result[$field] = isset($args[$field]) ? sanitize_text_field((string) $args[$field]) : '';
		}
		return $result;
	}

	private function should_search_extended_asset_data($search)
	{
		$search = trim((string) $search);
		if ($search === '') {
			return false;
		}
		if (strlen($search) < 3) {
			return false;
		}
		if (preg_match('/^(?:\d{1,3}\.){1,3}\d{0,3}$/', $search)) {
			return true;
		}
		if (preg_match('/^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){2,5}$/', $search)) {
			return true;
		}
		if (preg_match('/^[A-Za-z0-9_-]{8,}$/', $search)) {
			return true;
		}
		return false;
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
