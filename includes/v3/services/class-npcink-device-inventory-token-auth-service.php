<?php

// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.PreparedSQL.NotPrepared -- The options table name is provided by $wpdb; values are prepared below.
// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Atomic nonce claims and rate counters require single-statement database writes.

if (!defined('ABSPATH')) {
	exit;
}

class Npcink_Device_Inventory_Token_Auth_Service
{
	const RATE_LIMIT = 120;
	const RATE_WINDOW_SECONDS = 300;

	public function verify_request(WP_REST_Request $request)
	{
		$options = Npcink_Device_Inventory_V3_Tables::options();
		$tokens = isset($options['client_tokens']) && is_array($options['client_tokens']) ? $options['client_tokens'] : array();
		$token_id = sanitize_key((string) $request->get_header('x-npcink-device-token-id'));
		$timestamp = sanitize_text_field((string) $request->get_header('x-npcink-device-timestamp'));
		$nonce = sanitize_text_field((string) $request->get_header('x-npcink-device-nonce'));
		$signature = sanitize_text_field((string) $request->get_header('x-npcink-device-signature'));

		if ($token_id === '' || $timestamp === '' || $nonce === '' || $signature === '') {
			return Npcink_Device_Inventory_V3_Response::error('missing_signature', 'Device upload signature headers are required.', 401);
		}

		if (!ctype_digit($timestamp) || strlen($nonce) > 128 || !preg_match('/^sha256=[a-f0-9]{64}$/', $signature)) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_signature_headers', 'Device upload signature headers are invalid.', 401);
		}

		if (abs(time() - intval($timestamp)) > 300) {
			return Npcink_Device_Inventory_V3_Response::error('expired_signature', 'Device upload signature has expired.', 401);
		}

		$nonce_key = 'npcink_v3_upload_nonce_' . md5($token_id . ':' . $nonce);
		if (get_transient($nonce_key)) {
			return Npcink_Device_Inventory_V3_Response::error('replayed_nonce', 'Device upload nonce has already been used.', 401);
		}

		$token = null;
		foreach ($tokens as $candidate) {
			if (is_array($candidate) && isset($candidate['id']) && hash_equals((string) $candidate['id'], $token_id)) {
				$token = $candidate;
				break;
			}
		}

		if (!$token || empty($token['secret']) || empty($token['enabled'])) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_token', 'Device token is invalid or disabled.', 401);
		}

		$body_hash = hash('sha256', $request->get_body());
		$payload = $timestamp . "\n" . $nonce . "\n" . $body_hash;
		$expected = 'sha256=' . hash_hmac('sha256', $payload, (string) $token['secret']);
		if (!hash_equals($expected, $signature)) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_signature', 'Device upload signature is invalid.', 401);
		}

		if (!$this->claim_nonce($nonce_key)) {
			return Npcink_Device_Inventory_V3_Response::error('replayed_nonce', 'Device upload nonce has already been used.', 401);
		}
		$this->maybe_cleanup_security_options();

		$rate_limit = $this->consume_rate_limit($token_id);
		if (is_wp_error($rate_limit)) {
			return $rate_limit;
		}

		return true;
	}

	/**
	 * Claim a nonce exactly once. Object-cache add is atomic when a persistent
	 * cache is available; the options-table fallback relies on its unique key.
	 */
	private function claim_nonce($key)
	{
		$expires = time() + (5 * MINUTE_IN_SECONDS);
		if (function_exists('wp_using_ext_object_cache') && wp_using_ext_object_cache() && function_exists('wp_cache_add')) {
			return wp_cache_add($key, $expires, 'npcink_device_upload_nonce', 5 * MINUTE_IN_SECONDS);
		}

		global $wpdb;
		if (isset($wpdb) && is_object($wpdb) && isset($wpdb->options) && method_exists($wpdb, 'query') && method_exists($wpdb, 'prepare')) {
			$table = $wpdb->options;
			$sql = $wpdb->prepare(
				"INSERT INTO {$table} (option_name, option_value, autoload) VALUES (%s, %s, 'no') ON DUPLICATE KEY UPDATE option_value = IF(CAST(option_value AS UNSIGNED) < %d, VALUES(option_value), option_value)",
				$key,
				(string) $expires,
				 time()
			);
			// MySQL reports 1 for insert, 2 for replacing an expired claim, and
			// 0 when a valid claim already exists.
			$result = $wpdb->query($sql);
			return $result === 1 || $result === 2;
		}

		if (function_exists('get_option') && function_exists('add_option')) {
			// add_option is atomic for a unique option_name. Do not delete an
			// expired row here: a concurrent request could have just claimed it.
			return add_option($key, $expires, '', false);
		}

		// Compatibility fallback for isolated fixture environments without WP APIs.
		if (get_transient($key)) {
			return false;
		}
		return set_transient($key, 1, 5 * MINUTE_IN_SECONDS);
	}

	private function consume_rate_limit($token_id)
	{
		$window = (int) floor(time() / self::RATE_WINDOW_SECONDS);
		$key = 'npcink_v3_upload_rate_' . $window . '_' . md5($token_id . ':' . $window);
		$count = $this->increment_rate_counter($key);
		if ($count > self::RATE_LIMIT) {
			$retry_after = self::RATE_WINDOW_SECONDS - (time() % self::RATE_WINDOW_SECONDS);
			return Npcink_Device_Inventory_V3_Response::error(
				'upload_rate_limited',
				'Device upload rate limit exceeded.',
				429,
				array('retryAfter' => $retry_after)
			);
		}
		return true;
	}

	/**
	 * Increment the per-window counter atomically in the options table when
	 * available. The transient fallback is retained only for offline fixtures.
	 */
	private function increment_rate_counter($key)
	{
		global $wpdb;
		if (isset($wpdb) && is_object($wpdb) && isset($wpdb->options) && method_exists($wpdb, 'query') && method_exists($wpdb, 'prepare') && method_exists($wpdb, 'get_var')) {
			$table = $wpdb->options;
			$inserted = $wpdb->query($wpdb->prepare(
				"INSERT IGNORE INTO {$table} (option_name, option_value, autoload) VALUES (%s, '0', 'no')",
				$key
			));
			if ($inserted === false) {
				return self::RATE_LIMIT + 1;
			}
			$updated = $wpdb->query($wpdb->prepare(
				"UPDATE {$table} SET option_value = LAST_INSERT_ID(IF(CAST(option_value AS UNSIGNED) < %d, CAST(option_value AS UNSIGNED) + 1, %d)) WHERE option_name = %s",
				self::RATE_LIMIT,
				self::RATE_LIMIT + 1,
				$key
			));
			if ($updated === false || $updated === 0) {
				return self::RATE_LIMIT + 1;
			}
			$count = intval($wpdb->get_var('SELECT LAST_INSERT_ID()'));
			return $count > 0 ? $count : self::RATE_LIMIT + 1;
		}

		$count = intval(get_transient($key)) + 1;
		set_transient($key, $count, self::RATE_WINDOW_SECONDS + 5);
		return $count;
	}

	/**
	 * Bounded cleanup for the database fallbacks. Expiry is enforced during
	 * claims/counters; cleanup only prevents old option rows accumulating.
	 */
	private function maybe_cleanup_security_options()
	{
		global $wpdb;
		if (wp_rand(1, 100) !== 1 || !isset($wpdb) || !is_object($wpdb) || !isset($wpdb->options) || !method_exists($wpdb, 'query') || !method_exists($wpdb, 'prepare')) {
			return;
		}

		$table = $wpdb->options;
		$now = time();
		$wpdb->query($wpdb->prepare(
			"DELETE FROM {$table} WHERE option_name LIKE %s AND CAST(option_value AS UNSIGNED) < %d LIMIT 100",
			'npcink_v3_upload_nonce_%',
			$now
		));
		$cutoff = (int) floor($now / self::RATE_WINDOW_SECONDS) - 2;
		$wpdb->query($wpdb->prepare(
			"DELETE FROM {$table} WHERE option_name LIKE %s AND CAST(SUBSTRING_INDEX(SUBSTRING(option_name, CHAR_LENGTH('npcink_v3_upload_rate_') + 1), '_', 1) AS UNSIGNED) < %d LIMIT 100",
			'npcink_v3_upload_rate_%',
			$cutoff
		));
	}
}
