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
	const SCHEMA_REVISION = '20261027_observation_receipts';

	/** Create or repair the current schema without replaying historical data rewrites. */
	public static function run()
	{
		return self::upgrade_schema(get_option('npcink_device_inventory_schema_revision'), NPCINK_DEVICE_INVENTORY_VERSION);
	}

	public static function upgrade_schema($installed_revision, $current_version)
	{
		global $wpdb;
		$refresh_schema = $installed_revision !== self::SCHEMA_REVISION;
		$tables = array(
			self::$table_assets_name => 'create_table_assets',
			self::$table_asset_identities_name => 'create_table_asset_identities',
			self::$table_asset_observations_name => 'create_table_asset_observations',
			self::$table_asset_events_name => 'create_table_asset_events',
		);
		foreach ($tables as $suffix => $method) {
			$table = $wpdb->prefix . $suffix;
			if ($refresh_schema || $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) !== $table) {
				self::$method();
			}
			if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table))) !== $table) {
				return false;
			}
		}
		$identity_columns = $wpdb->get_var($wpdb->prepare(
			"SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
			FROM INFORMATION_SCHEMA.STATISTICS
			WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND INDEX_NAME = %s AND NON_UNIQUE = 0",
			$wpdb->prefix . self::$table_asset_identities_name,
			'identity'
		));
		if ($identity_columns !== 'identity_type,identity_value') {
			return false;
		}
		$asset_columns = $wpdb->get_var($wpdb->prepare(
			'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME IN (%s, %s, %s)',
			$wpdb->prefix . self::$table_assets_name,
			'financial_residual_value', 'latest_observation_id', 'latest_observed_at'
		));
		if (intval($asset_columns) !== 3) {
			return false;
		}
		$receipt_columns = $wpdb->get_var($wpdb->prepare(
			'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME IN (%s, %s)',
			$wpdb->prefix . self::$table_asset_observations_name,
			'observation_uuid', 'payload_hash'
		));
		if (intval($receipt_columns) !== 2) {
			return false;
		}
		$observation_key = $wpdb->get_var($wpdb->prepare(
			"SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND INDEX_NAME = %s AND NON_UNIQUE = 0",
			$wpdb->prefix . self::$table_asset_observations_name,
			'observation_uuid'
		));
		if ($observation_key !== 'observation_uuid') {
			return false;
		}
		self::create_default_v3_options();
		update_option('npcink_device_inventory_schema_revision', self::SCHEMA_REVISION);
		update_option('npcink_device_inventory_plugin_version', $current_version);
		update_option('npcink_device_inventory_data_model_version', '3');
		return true;
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
	        residual_value DECIMAL(12, 2) NOT NULL DEFAULT 0.00 COMMENT '二手市场价',
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
	        observation_uuid CHAR(36) DEFAULT NULL COMMENT 'Stable collection UUID for upload retries',
	        payload_hash CHAR(64) DEFAULT NULL COMMENT 'Canonical submitted facts SHA256',
	        schema_version SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '采集结构版本',
	        observed_at DATETIME NOT NULL COMMENT '采集时间',
	        received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '接收时间',
	        summary_json LONGTEXT COMMENT 'JSON encoded summary data',
	        hardware_json LONGTEXT COMMENT 'JSON encoded hardware detail',
	        raw_json LONGTEXT COMMENT 'JSON encoded raw source payload',
	        PRIMARY KEY  (id),
	        UNIQUE KEY observation_uuid (observation_uuid),
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

}
