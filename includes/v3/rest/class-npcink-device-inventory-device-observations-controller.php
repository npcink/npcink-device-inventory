<?php

if (!defined('ABSPATH')) {
	exit;
}

class Npcink_Device_Inventory_Device_Observations_Controller
{
	const MAX_BODY_BYTES = 2097152;
	const MAX_DEPTH = 12;
	const MAX_ARRAY_ITEMS = 512;
	const MAX_TOTAL_NODES = 5000;
	const MAX_STRING_BYTES = 10000;

	private $ingest;
	private $auth;

	public function __construct(
		Npcink_Device_Inventory_Observation_Ingest_Service $ingest,
		Npcink_Device_Inventory_Token_Auth_Service $auth
	) {
		$this->ingest = $ingest;
		$this->auth = $auth;
	}

	public function register_routes()
	{
		register_rest_route(
			'npcink-device-inventory/v1',
			'/device-observations',
			array(
				'methods' => WP_REST_Server::CREATABLE,
				'callback' => array($this, 'create_item'),
				'permission_callback' => array($this, 'permissions_check'),
			)
		);
		register_rest_route(
			'npcink-device-inventory/v1',
			'/device-observations/verify',
			array(
				'methods' => WP_REST_Server::READABLE,
				'callback' => array($this, 'verify_connection'),
				'permission_callback' => array($this, 'permissions_check'),
			)
		);
	}

	public function verify_connection()
	{
		return rest_ensure_response(array('data' => array('connected' => true)));
	}

	public function permissions_check($request)
	{
		if (current_user_can('manage_options')) {
			return true;
		}
		return $this->auth->verify_request($request);
	}

	public function create_item($request)
	{
		$content_length = intval($request->get_header('content-length'));
		if ($content_length > self::MAX_BODY_BYTES) {
			return Npcink_Device_Inventory_V3_Response::error('observation_too_large', 'Observation body exceeds 2 MB.', 413);
		}
		$body = (string) $request->get_body();
		if (strlen($body) > self::MAX_BODY_BYTES) {
			return Npcink_Device_Inventory_V3_Response::error('observation_too_large', 'Observation body exceeds 2 MB.', 413);
		}
		$params = $request->get_json_params();
		if (!is_array($params)) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_json', 'Request body must be valid JSON.', 400);
		}
		$nodes = 0;
		$shape_check = $this->validate_payload_shape($params, 0, $nodes);
		if (is_wp_error($shape_check)) {
			return $shape_check;
		}
		return rest_ensure_response($this->ingest->ingest($params));
	}

	private function validate_payload_shape($value, $depth, &$nodes)
	{
		$nodes++;
		if ($nodes > self::MAX_TOTAL_NODES || $depth > self::MAX_DEPTH) {
			return Npcink_Device_Inventory_V3_Response::error('observation_too_complex', 'Observation structure is too large or deeply nested.', 413);
		}
		if (is_array($value)) {
			if (count($value) > self::MAX_ARRAY_ITEMS) {
				return Npcink_Device_Inventory_V3_Response::error('observation_too_complex', 'Observation array contains too many items.', 413);
			}
			foreach ($value as $item) {
				$result = $this->validate_payload_shape($item, $depth + 1, $nodes);
				if (is_wp_error($result)) {
					return $result;
				}
			}
		} elseif (is_string($value) && strlen($value) > self::MAX_STRING_BYTES) {
			return Npcink_Device_Inventory_V3_Response::error('observation_string_too_large', 'Observation contains an oversized string.', 413);
		}
		return true;
	}
}
