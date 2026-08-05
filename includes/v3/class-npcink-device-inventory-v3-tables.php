<?php

if (!defined('ABSPATH')) {
	exit;
}

class Npcink_Device_Inventory_V3_Tables
{
	public const DEFAULT_DEPARTMENT = '未分配';
	public const OPTION = 'npcink_device_inventory_v3_options';
	public const ASSETS = 'npcink_assets';
	public const IDENTITIES = 'npcink_asset_identities';
	public const OBSERVATIONS = 'npcink_asset_observations';
	public const EVENTS = 'npcink_asset_events';

	public static function name($table)
	{
		global $wpdb;
		return $wpdb->prefix . $table;
	}

	public static function assets()
	{
		return self::name(self::ASSETS);
	}

	public static function identities()
	{
		return self::name(self::IDENTITIES);
	}

	public static function observations()
	{
		return self::name(self::OBSERVATIONS);
	}

	public static function events()
	{
		return self::name(self::EVENTS);
	}

	public static function default_options()
	{
		return array(
			'client_tokens' => array(),
			'client_upload_base_url' => '',
			'observation_retention_days' => 0,
			'asset_number_prefix' => 'A',
			'depreciation_period_months' => 36,
			'default_residual_rate' => 5,
			'renewal_age_years' => 5,
			'renewal_min_memory_gb' => 8,
			'renewal_min_disk_gb' => 256,
			'renewal_max_residual_rate' => 20,
			'count_available_assets_only' => true,
			'departments' => array(self::DEFAULT_DEPARTMENT),
			'delete_data_on_uninstall' => false,
		);
	}

	public static function normalize_department($department)
	{
		$value = sanitize_text_field((string) $department);
		$value = trim($value);
		if ($value === '') {
			return self::DEFAULT_DEPARTMENT;
		}
		return self::truncate_text($value, 80);
	}

	public static function normalize_departments($departments)
	{
		if (!is_array($departments)) {
			return array();
		}
		$normalized = array();
		foreach ($departments as $department) {
			$value = sanitize_text_field((string) $department);
			$value = trim($value);
			$value = self::truncate_text($value, 80);
			if ($value === '' || in_array($value, $normalized, true)) {
				continue;
			}
			$normalized[] = $value;
		}
		sort($normalized, SORT_NATURAL | SORT_FLAG_CASE);
		return $normalized;
	}

	public static function normalize_departments_with_default($departments)
	{
		$normalized = self::normalize_departments($departments);
		if (!in_array(self::DEFAULT_DEPARTMENT, $normalized, true)) {
			$normalized[] = self::DEFAULT_DEPARTMENT;
		}
		sort($normalized, SORT_NATURAL | SORT_FLAG_CASE);
		return $normalized;
	}

	public static function options()
	{
		$options = get_option(self::OPTION);
		if (!is_array($options)) {
			$options = array();
		}
		return array_merge(self::default_options(), $options);
	}

	private static function truncate_text($value, $length)
	{
		return function_exists('mb_substr')
			? mb_substr((string) $value, 0, $length, 'UTF-8')
			: substr((string) $value, 0, $length);
	}
}
