<?php

if (!defined('ABSPATH')) {
	exit;
}

class Npcink_Device_Inventory_Settings_Controller
{
	public function register_routes()
	{
		register_rest_route(
			'npcink-device-inventory/v1',
			'/settings',
			array(
				array(
					'methods' => WP_REST_Server::READABLE,
					'callback' => array($this, 'get_settings'),
					'permission_callback' => array($this, 'admin_permissions_check'),
				),
				array(
					'methods' => WP_REST_Server::EDITABLE,
					'callback' => array($this, 'update_settings'),
					'permission_callback' => array($this, 'admin_permissions_check'),
				),
			)
		);

		register_rest_route(
			'npcink-device-inventory/v1',
			'/client-tokens',
			array(
				'methods' => WP_REST_Server::CREATABLE,
				'callback' => array($this, 'create_token'),
				'permission_callback' => array($this, 'admin_permissions_check'),
			)
		);

		register_rest_route(
			'npcink-device-inventory/v1',
			'/client-tokens/(?P<id>[a-z0-9]{12})',
			array(
				array(
					'methods' => WP_REST_Server::EDITABLE,
					'callback' => array($this, 'update_token'),
					'permission_callback' => array($this, 'admin_permissions_check'),
				),
				array(
					'methods' => WP_REST_Server::DELETABLE,
					'callback' => array($this, 'delete_token'),
					'permission_callback' => array($this, 'admin_permissions_check'),
				),
			)
		);

	}

	public function admin_permissions_check()
	{
		if (!current_user_can('manage_options')) {
			return Npcink_Device_Inventory_V3_Response::error('forbidden', 'Administrator permission is required.', 403);
		}
		return true;
	}

	public function get_settings()
	{
		return rest_ensure_response(array('data' => $this->public_options(Npcink_Device_Inventory_V3_Tables::options())));
	}

	public function update_settings($request)
	{
		$params = $request->get_json_params();
		if (!is_array($params)) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_json', 'Request body must be valid JSON.', 400);
		}

		$options = Npcink_Device_Inventory_V3_Tables::options();
		if (array_key_exists('clientUploadBaseUrl', $params)) {
			$options['client_upload_base_url'] = esc_url_raw((string) $params['clientUploadBaseUrl']);
		}
		if (array_key_exists('observationRetentionDays', $params)) {
			$options['observation_retention_days'] = max(0, intval($params['observationRetentionDays']));
		}
		if (array_key_exists('assetNumberPrefix', $params)) {
			$options['asset_number_prefix'] = preg_replace('/[^A-Za-z0-9_-]/', '', (string) $params['assetNumberPrefix']);
		}
		if (array_key_exists('depreciationPeriodMonths', $params)) {
			$options['depreciation_period_months'] = min(240, max(1, intval($params['depreciationPeriodMonths'])));
		}
		if (array_key_exists('defaultResidualRate', $params)) {
			$options['default_residual_rate'] = min(100, max(0, floatval($params['defaultResidualRate'])));
		}
		if (array_key_exists('renewalAgeYears', $params)) {
			$options['renewal_age_years'] = min(20, max(1, intval($params['renewalAgeYears'])));
		}
		if (array_key_exists('renewalMinMemoryGb', $params)) {
			$options['renewal_min_memory_gb'] = min(512, max(1, intval($params['renewalMinMemoryGb'])));
		}
		if (array_key_exists('renewalMinDiskGb', $params)) {
			$options['renewal_min_disk_gb'] = min(8192, max(1, intval($params['renewalMinDiskGb'])));
		}
		if (array_key_exists('renewalMaxResidualRate', $params)) {
			$options['renewal_max_residual_rate'] = min(100, max(0, floatval($params['renewalMaxResidualRate'])));
		}
		if (array_key_exists('countAvailableAssetsOnly', $params)) {
			$options['count_available_assets_only'] = (bool) $params['countAvailableAssetsOnly'];
		}
		if (array_key_exists('departments', $params)) {
			$options['departments'] = Npcink_Device_Inventory_V3_Tables::normalize_departments_with_default($params['departments']);
		}
		if (array_key_exists('deleteDataOnUninstall', $params)) {
			$options['delete_data_on_uninstall'] = (bool) $params['deleteDataOnUninstall'];
		}

		update_option(Npcink_Device_Inventory_V3_Tables::OPTION, $options);
		return rest_ensure_response(array('data' => $this->public_options($options)));
	}

	public function create_token($request)
	{
		$params = $request->get_json_params();
		$name = is_array($params) && !empty($params['name']) ? sanitize_text_field($params['name']) : 'Device token';
		$options = Npcink_Device_Inventory_V3_Tables::options();
		$secret = $this->random_secret();
		$token = array(
			'id' => strtolower(substr(wp_generate_password(16, false, false), 0, 12)),
			'name' => $name,
			'secret' => $secret,
			'enabled' => true,
			'created_at' => current_time('mysql'),
		);
		$options['client_tokens'][] = $token;
		update_option(Npcink_Device_Inventory_V3_Tables::OPTION, $options);

		$public = $this->public_token($token);
		$public['secret'] = $secret;
		return rest_ensure_response(array('data' => $public));
	}

	public function delete_token($request)
	{
		$id = sanitize_key((string) $request['id']);
		$options = Npcink_Device_Inventory_V3_Tables::options();
		$tokens = array();
		foreach ($options['client_tokens'] as $token) {
			if (!is_array($token) || !isset($token['id']) || $token['id'] === $id) {
				continue;
			}
			$tokens[] = $token;
		}
		$options['client_tokens'] = $tokens;
		update_option(Npcink_Device_Inventory_V3_Tables::OPTION, $options);
		return rest_ensure_response(array('data' => array('success' => true)));
	}

	public function update_token($request)
	{
		$id = sanitize_key((string) $request['id']);
		$params = $request->get_json_params();
		if (!is_array($params) || !array_key_exists('enabled', $params)) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_token_update', 'Token enabled state is required.', 400);
		}

		$options = Npcink_Device_Inventory_V3_Tables::options();
		$tokens = array();
		$updated = null;
		foreach ($options['client_tokens'] as $token) {
			if (!is_array($token)) {
				continue;
			}
			if (isset($token['id']) && $token['id'] === $id) {
				$token['enabled'] = (bool) $params['enabled'];
				$updated = $token;
			}
			$tokens[] = $token;
		}

		if (!$updated) {
			return Npcink_Device_Inventory_V3_Response::error('token_not_found', 'Client token not found.', 404);
		}

		$options['client_tokens'] = $tokens;
		update_option(Npcink_Device_Inventory_V3_Tables::OPTION, $options);
		return rest_ensure_response(array('data' => $this->public_token($updated)));
	}

	private function public_options($options)
	{
		$tokens = array();
		if (!empty($options['client_tokens']) && is_array($options['client_tokens'])) {
			foreach ($options['client_tokens'] as $token) {
				if (is_array($token)) {
					$tokens[] = $this->public_token($token);
				}
			}
		}

		return array(
			'clientUploadBaseUrl' => (string) $options['client_upload_base_url'],
			'observationRetentionDays' => intval($options['observation_retention_days']),
			'assetNumberPrefix' => (string) $options['asset_number_prefix'],
			'depreciationPeriodMonths' => intval($options['depreciation_period_months']),
			'defaultResidualRate' => floatval($options['default_residual_rate']),
			'renewalAgeYears' => intval($options['renewal_age_years']),
			'renewalMinMemoryGb' => intval($options['renewal_min_memory_gb']),
			'renewalMinDiskGb' => intval($options['renewal_min_disk_gb']),
			'renewalMaxResidualRate' => floatval($options['renewal_max_residual_rate']),
			'countAvailableAssetsOnly' => !empty($options['count_available_assets_only']),
			'departments' => $this->settings_departments($options),
			'deleteDataOnUninstall' => !empty($options['delete_data_on_uninstall']),
			'clientTokens' => $tokens,
		);
	}

	private function settings_departments($options)
	{
		$raw_options = get_option(Npcink_Device_Inventory_V3_Tables::OPTION);
		if (is_array($raw_options) && array_key_exists('departments', $raw_options)) {
			return Npcink_Device_Inventory_V3_Tables::normalize_departments_with_default($raw_options['departments']);
		}
		return Npcink_Device_Inventory_V3_Tables::normalize_departments_with_default($this->asset_departments());
	}

	private function asset_departments()
	{
		global $wpdb;
		$table = Npcink_Device_Inventory_V3_Tables::assets();
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- One-time fallback reads current departments from the plugin-owned assets table when no department setting exists; caching would require invalidation on every asset write.
		$rows = $wpdb->get_col(
			$wpdb->prepare('SELECT DISTINCT department FROM %i WHERE department <> %s ORDER BY department ASC', $table, '')
		);
		if (!is_array($rows)) {
			return array();
		}
		return Npcink_Device_Inventory_V3_Tables::normalize_departments($rows);
	}

	private function public_token($token)
	{
		return array(
			'id' => isset($token['id']) ? (string) $token['id'] : '',
			'name' => isset($token['name']) ? (string) $token['name'] : '',
			'enabled' => !empty($token['enabled']),
			'createdAt' => isset($token['created_at']) ? (string) $token['created_at'] : '',
		);
	}

	private function random_secret()
	{
		if (function_exists('random_bytes')) {
			try {
				return bin2hex(random_bytes(32));
			} catch (Exception $e) {
				// Fall through.
			}
		}
		return wp_generate_password(64, false, false);
	}
}
