<?php

if (!defined('ABSPATH')) {
	exit;
}

class Npcink_Device_Inventory_V3_Tables
{
	public const DEFAULT_DEPARTMENT = '未分配';
	public const OPTION = 'npcink_device_inventory_v3_options';
	public const CLIENT_TOKENS_OPTION = 'npcink_device_inventory_v3_client_tokens';
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
			'client_upload_base_url' => '',
			'observation_retention_days' => 0,
			'asset_number_prefix' => 'A',
			'depreciation_period_months' => 36,
			'default_residual_rate' => 5,
			'renewal_age_years' => 5,
			'renewal_min_memory_gb' => 8,
			'renewal_min_disk_gb' => 256,
			'renewal_max_residual_rate' => 20,
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
		self::migrate_client_tokens();
		$options = get_option(self::OPTION);
		if (!is_array($options)) {
			$options = array();
		}
		unset($options['client_tokens']);
		return array_merge(self::default_options(), $options);
	}

	public static function client_tokens()
	{
		self::migrate_client_tokens();
		$tokens = get_option(self::CLIENT_TOKENS_OPTION, array());
		return is_array($tokens) ? array_values($tokens) : array();
	}

	public static function update_options($options)
	{
		if (!is_array($options)) {
			$options = array();
		}
		unset($options['client_tokens']);
		update_option(self::OPTION, $options);
	}

	public static function update_client_tokens($tokens)
	{
		if (!is_array($tokens)) {
			$tokens = array();
		}
		self::migrate_client_tokens();
		if (get_option(self::CLIENT_TOKENS_OPTION, false) === false) {
			add_option(self::CLIENT_TOKENS_OPTION, $tokens, '', false);
		} else {
			update_option(self::CLIENT_TOKENS_OPTION, $tokens, false);
		}
		self::ensure_client_tokens_autoload_disabled();
	}

	public static function migrate_client_tokens()
	{
		$options = get_option(self::OPTION);
		if (is_array($options) && array_key_exists('client_tokens', $options)) {
			$legacy = is_array($options['client_tokens']) ? $options['client_tokens'] : array();
			$existing = get_option(self::CLIENT_TOKENS_OPTION, false);
			if ($existing === false) {
				add_option(self::CLIENT_TOKENS_OPTION, $legacy, '', false);
			} elseif ($legacy && (!is_array($existing) || !$existing)) {
				update_option(self::CLIENT_TOKENS_OPTION, $legacy, false);
			}
			unset($options['client_tokens']);
			update_option(self::OPTION, $options);
		}
		self::ensure_client_tokens_autoload_disabled();
	}

	private static function ensure_client_tokens_autoload_disabled()
	{
		if (get_option(self::CLIENT_TOKENS_OPTION, false) === false) {
			return;
		}
		if (function_exists('wp_load_alloptions')) {
			$all = wp_load_alloptions();
			if (is_array($all) && !array_key_exists(self::CLIENT_TOKENS_OPTION, $all)) {
				return;
			}
		}
		if (function_exists('wp_set_option_autoload')) {
			wp_set_option_autoload(self::CLIENT_TOKENS_OPTION, false);
			return;
		}

		global $wpdb;
		if (!isset($wpdb) || !is_object($wpdb) || empty($wpdb->options)) {
			return;
		}
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- WP 6.5 has no wp_set_option_autoload; only repair a leftover autoload flag.
		$autoload = $wpdb->get_var($wpdb->prepare(
			'SELECT autoload FROM %i WHERE option_name = %s',
			$wpdb->options,
			self::CLIENT_TOKENS_OPTION
		));
		if (!is_string($autoload) || in_array(strtolower($autoload), array('no', 'off', 'auto-off'), true)) {
			return;
		}
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- See autoload repair note above.
		$wpdb->update($wpdb->options, array('autoload' => 'no'), array('option_name' => self::CLIENT_TOKENS_OPTION));
		if (function_exists('wp_cache_delete')) {
			wp_cache_delete('alloptions', 'options');
			wp_cache_delete(self::CLIENT_TOKENS_OPTION, 'options');
		}
	}

	private static function truncate_text($value, $length)
	{
		return function_exists('mb_substr')
			? mb_substr((string) $value, 0, $length, 'UTF-8')
			: substr((string) $value, 0, $length);
	}
}
