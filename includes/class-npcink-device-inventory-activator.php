<?php

if (!defined('ABSPATH')) {
	exit;
}

// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.PreparedSQL.InterpolatedNotPrepared,PluginCheck.Security.DirectDB.UnescapedDBParameter -- Activation SQL only touches plugin-owned tables and internally constructed schema fragments.
// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.DirectDatabaseQuery.SchemaChange -- Activation and upgrade routines create or update plugin-owned custom tables, indexes, and triggers.

/**
 * 在插件激活期间激发 - 创建数据表用
 *
 * @link       https://www.npc.ink
 * @since      1.0.0
 *
 * @package    Npcink_Device_Inventory
 * @subpackage Npcink_Device_Inventory/includes
 */

/**
 * Fired during plugin activation.
 *
 * This class defines all code necessary to run during the plugin's activation.
 *
 * @since      1.0.0
 * @package    Npcink_Device_Inventory
 * @subpackage Npcink_Device_Inventory/includes
 * @author     Npcink <1355471563@qq.com>
 */
class Npcink_Device_Inventory_Activator extends Npcink_Device_Inventory_Admin_Interface
{
	const SCHEMA_REVISION = '20260807_retired_values_zero';
	const SCHEMA_REVISIONS = array(
		'20260706_latest_observed',
		'20260715_atomic_identity',
		'20260715_scope_reset',
		'20260806_financial_values',
		'20260807_computer_device_type_default',
		self::SCHEMA_REVISION,
	);

	/**
	 * 插件激活时运行的主要方法
	 *
	 * @since    1.0.0
	 */
	public static function run()
	{
		$current_version = defined('NPCINK_DEVICE_INVENTORY_VERSION') ? NPCINK_DEVICE_INVENTORY_VERSION : '1.0.0';
		self::upgrade_schema(get_option('npcink_device_inventory_schema_revision'), $current_version);
	}

	/**
	 * 版本升级时执行数据库与索引增量迁移
	 */
	public static function upgrade_schema($installed_revision, $current_version)
	{
		self::create_default_v3_options();
		foreach (self::pending_schema_revisions($installed_revision) as $revision) {
			$migrated = self::run_schema_migration($revision);
			if (!$migrated) {
				return false;
			}
			update_option('npcink_device_inventory_schema_revision', $revision);
		}

		if (!empty($current_version)) {
			update_option('npcink_device_inventory_plugin_version', $current_version);
		}
		update_option('npcink_device_inventory_data_model_version', '3');
		return true;
	}

	/**
	 * Return the ordered migrations that have not yet been committed.
	 */
	public static function pending_schema_revisions($installed_revision)
	{
		$installed_revision = is_string($installed_revision) ? $installed_revision : '';
		$installed_index = array_search($installed_revision, self::SCHEMA_REVISIONS, true);
		if ($installed_index === false) {
			return self::SCHEMA_REVISIONS;
		}
		return array_slice(self::SCHEMA_REVISIONS, $installed_index + 1);
	}

	/**
	 * Run one named schema migration. The revision option is updated by the caller only on success.
	 */
	private static function run_schema_migration($revision)
	{
		if ($revision === '20260706_latest_observed') {
			// 新资产模型：资产、身份、采集快照、统一事件。
			self::create_table_assets();
			self::create_table_asset_identities();
			self::create_table_asset_observations();
			self::create_table_asset_events();
			if (!self::normalize_json_storage_columns()) {
				return false;
			}
			return self::sync_latest_observation_columns();
		}

		if ($revision === '20260715_atomic_identity') {
			// Atomic identity claims depend on the unique identity key. dbDelta repairs it if needed.
			self::create_table_asset_identities();
			return self::identity_unique_key_ready();
		}

		if ($revision === '20260715_scope_reset') {
			return self::reset_pre_ga_scope();
		}

		if ($revision === '20260806_financial_values') {
			// Keep the legacy residual_value column as second-hand market value and add a distinct accounting value.
			return self::add_financial_residual_value_column();
		}

		if ($revision === '20260807_computer_device_type_default') {
			return self::normalize_computer_device_type();
		}

		if ($revision === self::SCHEMA_REVISION) {
			return self::normalize_retired_values();
		}

		return false;
	}

	/**
	 * Give computer assets a user-facing default subtype and normalize the former labels.
	 */
	private static function normalize_computer_device_type()
	{
		global $wpdb;
		$assets = self::quote_internal_table_name($wpdb->prefix . self::$table_assets_name);
		if (!$assets) {
			return false;
		}

		return $wpdb->query(
			"UPDATE $assets
			SET category = '台式电脑'
			WHERE asset_type = 'computer'
			AND (TRIM(category) = '' OR category IN ('computer', '台式机'))"
		) !== false;
	}

	/**
	 * Retired assets retain historical purchase cost but no current market or carrying value.
	 */
	private static function normalize_retired_values()
	{
		global $wpdb;
		$assets = self::quote_internal_table_name($wpdb->prefix . self::$table_assets_name);
		if (!$assets) {
			return false;
		}

		return $wpdb->query(
			"UPDATE $assets
			SET residual_value = 0.00, financial_residual_value = 0.00
			WHERE status = 'retired'
			AND (residual_value <> 0.00 OR financial_residual_value <> 0.00)"
		) !== false;
	}

	/**
	 * Apply the destructive pre-GA contract reset to development data.
	 */
	private static function reset_pre_ga_scope()
	{
		global $wpdb;
		$assets = self::quote_internal_table_name($wpdb->prefix . self::$table_assets_name);
		$identities = self::quote_internal_table_name($wpdb->prefix . self::$table_asset_identities_name);
		$events = self::quote_internal_table_name($wpdb->prefix . self::$table_asset_events_name);
		if (!$assets || !$identities || !$events) {
			return false;
		}

		$assets_updated = $wpdb->query(
			"UPDATE $assets
			SET category = CASE
				WHEN asset_type NOT IN ('pc', 'computer', 'custom') AND TRIM(category) = '' THEN asset_type
				ELSE category
			END,
			asset_type = CASE WHEN asset_type IN ('pc', 'computer') THEN 'computer' ELSE 'custom' END"
		);
		if ($assets_updated === false) {
			return false;
		}

		$identities_deleted = $wpdb->query(
			"DELETE FROM $identities WHERE identity_type NOT IN ('system_uuid_v2', 'baseboard_serial_v2', 'pci_permanent_mac_v2', 'device_uuid_v1', 'fallback_device_v1')"
		);
		if ($identities_deleted === false) {
			return false;
		}

		$events_deleted = $wpdb->query(
			"DELETE FROM $events WHERE event_type IN ('issue_handled', 'issue_reopened', 'identity_reconciled')"
		);
		if ($events_deleted === false) {
			return false;
		}

		$options = get_option('npcink_device_inventory_v3_options');
		if (is_array($options)) {
			unset(
				$options['public_query_enabled'],
				$options['public_query_page_slug'],
				$options['public_query_access_code_hash']
			);
			update_option('npcink_device_inventory_v3_options', $options);
		}
		return true;
	}

	/**
	 * Verify the exact unique key required by atomic identity claims.
	 */
	private static function identity_unique_key_ready()
	{
		global $wpdb;
		$table_name = $wpdb->prefix . self::$table_asset_identities_name;
		$columns = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
				FROM INFORMATION_SCHEMA.STATISTICS
				WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND INDEX_NAME = %s AND NON_UNIQUE = 0",
				$table_name,
				'identity'
			)
		);
		return (string) $columns === 'identity_type,identity_value';
	}

	private static function financial_value_column_ready()
	{
		global $wpdb;
		$table_name = $wpdb->prefix . self::$table_assets_name;
		$count = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s',
				$table_name,
				'financial_residual_value'
			)
		);
		return intval($count) === 1;
	}

	private static function add_financial_residual_value_column()
	{
		global $wpdb;
		if (self::financial_value_column_ready()) {
			return true;
		}
		$table_name = $wpdb->prefix . self::$table_assets_name;
		$quoted_table = self::quote_internal_table_name($table_name);
		if ($quoted_table === null) {
			return false;
		}
		$added = $wpdb->query(
			"ALTER TABLE $quoted_table ADD COLUMN `financial_residual_value` DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT '财务残值' AFTER `residual_value`"
		);
		return $added !== false && self::financial_value_column_ready();
	}

	/**
	 * 校验并转义插件内部表名。
	 */
	private static function quote_internal_table_name($table_name)
	{
		global $wpdb;
		$allowed_tables = array(
			$wpdb->prefix . self::$table_assets_name,
			$wpdb->prefix . self::$table_asset_identities_name,
			$wpdb->prefix . self::$table_asset_observations_name,
			$wpdb->prefix . self::$table_asset_events_name,
		);

		if (!is_string($table_name) || !in_array($table_name, $allowed_tables, true) || !preg_match('/^[A-Za-z0-9_]+$/', $table_name)) {
			return null;
		}

		return '`' . str_replace('`', '``', $table_name) . '`';
	}

	/**
	 * 创建 v3 默认选项。
	 */
	private static function create_default_v3_options()
	{
		if (get_option('npcink_device_inventory_v3_options') !== false) {
			return;
		}

		update_option(
			'npcink_device_inventory_v3_options',
			array(
				'client_tokens' => array(),
				'client_upload_base_url' => '',
				'observation_retention_days' => 0,
				'asset_number_prefix' => 'A',
				'depreciation_period_months' => 36,
				'default_residual_rate' => 5,
				'count_available_assets_only' => true,
				'departments' => array('未分配'),
				'delete_data_on_uninstall' => false,
			)
		);
	}

	/**
	 * 创建资产主表。
	 */
	public static function create_table_assets()
	{
		global $wpdb;

		$table_name = $wpdb->prefix . self::$table_assets_name;
		$sql = "CREATE TABLE `$table_name` (
	        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	        uuid CHAR(36) NOT NULL COMMENT '资产UUID',
	        asset_type VARCHAR(64) NOT NULL COMMENT '资产类型',
	        asset_number VARCHAR(64) NOT NULL COMMENT '资产编号',
	        name VARCHAR(191) NOT NULL DEFAULT '' COMMENT '资产名称',
	        owner_name VARCHAR(191) NOT NULL DEFAULT '' COMMENT '使用人',
	        department VARCHAR(191) NOT NULL DEFAULT '' COMMENT '部门',
	        status VARCHAR(64) NOT NULL DEFAULT 'active' COMMENT '资产状态',
	        category VARCHAR(191) NOT NULL DEFAULT '' COMMENT '分类',
	        purchase_price DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT '采购价',
	        residual_value DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT '二手市场价（legacy column name）',
	        financial_residual_value DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT '财务残值',
	        metadata_json LONGTEXT COMMENT 'JSON encoded extended asset information',
	        latest_observation_id BIGINT UNSIGNED DEFAULT NULL COMMENT 'Latest observation row ID',
	        latest_observed_at DATETIME DEFAULT NULL COMMENT 'Latest observation time',
	        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
	        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
	        PRIMARY KEY  (id),
	        UNIQUE KEY uuid (uuid),
	        UNIQUE KEY asset_number (asset_number),
	        KEY idx_asset_type_status (asset_type, status),
	        KEY idx_department_status (department, status),
	        KEY idx_owner_name (owner_name),
	        KEY idx_category (category),
	        KEY idx_latest_observed (latest_observed_at, updated_at),
	        KEY idx_latest_observation_id (latest_observation_id),
	        KEY idx_updated_at (updated_at)
	     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='资产主表';";

		require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
		dbDelta($sql);
	}

	/**
	 * 创建资产身份表。
	 */
	public static function create_table_asset_identities()
	{
		global $wpdb;

		$table_name = $wpdb->prefix . self::$table_asset_identities_name;
		$sql = "CREATE TABLE `$table_name` (
	        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	        asset_id BIGINT UNSIGNED NOT NULL COMMENT '资产ID',
	        identity_type VARCHAR(64) NOT NULL COMMENT '身份类型',
	        identity_value VARCHAR(191) NOT NULL COMMENT '身份值',
	        confidence DECIMAL(5, 2) NOT NULL DEFAULT 100.00 COMMENT '匹配置信度',
	        is_primary TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否主身份',
	        source VARCHAR(64) NOT NULL DEFAULT '' COMMENT '身份来源',
	        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
	        PRIMARY KEY  (id),
	        UNIQUE KEY identity (identity_type, identity_value),
	        KEY idx_asset_id (asset_id),
	        KEY idx_asset_identity (asset_id, identity_type),
	        KEY idx_primary_identity (asset_id, is_primary)
	     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='资产身份表';";

		require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
		dbDelta($sql);
	}

	/**
	 * 创建资产采集快照表。
	 */
	public static function create_table_asset_observations()
	{
		global $wpdb;

		$table_name = $wpdb->prefix . self::$table_asset_observations_name;
		$sql = "CREATE TABLE `$table_name` (
	        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	        asset_id BIGINT UNSIGNED NOT NULL COMMENT '资产ID',
	        source VARCHAR(64) NOT NULL COMMENT '采集来源',
	        schema_version SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '采集结构版本',
	        observed_at DATETIME NOT NULL COMMENT '采集时间',
	        received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '接收时间',
	        summary_json LONGTEXT COMMENT 'JSON encoded summary data',
	        hardware_json LONGTEXT COMMENT 'JSON encoded hardware detail',
	        raw_json LONGTEXT COMMENT 'JSON encoded raw source payload',
	        PRIMARY KEY  (id),
	        KEY idx_asset_observed (asset_id, observed_at),
	        KEY idx_source_observed (source, observed_at),
	        KEY idx_schema_version (schema_version),
	        KEY idx_received_at (received_at)
	     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='资产采集快照表';";

		require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
		dbDelta($sql);
	}

	/**
	 * 创建资产事件表。
	 */
	public static function create_table_asset_events()
	{
		global $wpdb;

		$table_name = $wpdb->prefix . self::$table_asset_events_name;
		$sql = "CREATE TABLE `$table_name` (
	        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
	        asset_id BIGINT UNSIGNED COMMENT '资产ID',
	        event_source VARCHAR(64) NOT NULL COMMENT '事件来源',
	        event_type VARCHAR(64) NOT NULL COMMENT '事件类型',
	        field_name VARCHAR(191) COMMENT '字段名',
	        old_value LONGTEXT COMMENT '变更前值',
	        new_value LONGTEXT COMMENT '变更后值',
	        message TEXT COMMENT '事件说明',
	        actor_user_id BIGINT UNSIGNED COMMENT '操作人用户ID',
	        actor_name VARCHAR(191) NOT NULL DEFAULT '' COMMENT '操作人名称',
	        payload_json LONGTEXT COMMENT 'JSON encoded event payload',
	        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
	        PRIMARY KEY  (id),
	        KEY idx_asset_created (asset_id, created_at),
	        KEY idx_source_type (event_source, event_type),
	        KEY idx_field_name (field_name),
	        KEY idx_actor_user_id (actor_user_id),
	        KEY idx_created_at (created_at)
	     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='资产事件表';";

		require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
		dbDelta($sql);
	}

	/**
	 * Keep JSON-like storage portable across MySQL and MariaDB variants.
	 */
	private static function normalize_json_storage_columns()
	{
		global $wpdb;
		$columns = array(
			array($wpdb->prefix . self::$table_assets_name, 'metadata_json', 'JSON encoded extended asset information'),
			array($wpdb->prefix . self::$table_asset_observations_name, 'summary_json', 'JSON encoded summary data'),
			array($wpdb->prefix . self::$table_asset_observations_name, 'hardware_json', 'JSON encoded hardware detail'),
			array($wpdb->prefix . self::$table_asset_observations_name, 'raw_json', 'JSON encoded raw source payload'),
			array($wpdb->prefix . self::$table_asset_events_name, 'payload_json', 'JSON encoded event payload'),
		);

		foreach ($columns as $column) {
			list($table_name, $column_name, $comment) = $column;
			$quoted_table = self::quote_internal_table_name($table_name);
			if ($quoted_table === null || !preg_match('/^[A-Za-z0-9_]+$/', $column_name)) {
				return false;
			}

			$column_type = $wpdb->get_var(
				$wpdb->prepare(
					'SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s',
					$table_name,
					$column_name
				)
			);
			if (strtolower((string) $column_type) === 'longtext') {
				continue;
			}
			if ($column_type === null) {
				return false;
			}

			if (
				$wpdb->query(
					"ALTER TABLE $quoted_table MODIFY `$column_name` LONGTEXT COMMENT '" . esc_sql($comment) . "'"
				) === false
			) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Backfill denormalized latest observation columns used by the admin asset list.
	 */
	private static function sync_latest_observation_columns()
	{
		global $wpdb;
		$assets_table = $wpdb->prefix . self::$table_assets_name;
		$observations_table = $wpdb->prefix . self::$table_asset_observations_name;
		$quoted_assets = self::quote_internal_table_name($assets_table);
		$quoted_observations = self::quote_internal_table_name($observations_table);
		if ($quoted_assets === null || $quoted_observations === null) {
			return false;
		}
		$column_count = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME IN (%s, %s)',
				$assets_table,
				'latest_observation_id',
				'latest_observed_at'
			)
		);
		if (intval($column_count) !== 2) {
			return false;
		}

		$result = $wpdb->query(
			"UPDATE $quoted_assets a
			SET
				a.updated_at = a.updated_at,
				a.latest_observation_id = (
					SELECT o.id
					FROM $quoted_observations o
					WHERE o.asset_id = a.id
					ORDER BY o.observed_at DESC, o.id DESC
					LIMIT 1
				),
				a.latest_observed_at = (
					SELECT o.observed_at
					FROM $quoted_observations o
					WHERE o.asset_id = a.id
					ORDER BY o.observed_at DESC, o.id DESC
					LIMIT 1
				)"
		);
		return $result !== false;
	}
}
