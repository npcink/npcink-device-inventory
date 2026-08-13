<?php

define('ABSPATH', __DIR__ . '/');
define('MINUTE_IN_SECONDS', 60);

class WP_Error
{
	private $code;
	private $data;

	public function __construct($code, $message = '', $data = array())
	{
		$this->code = $code;
		$this->data = $data;
	}

	public function get_error_code()
	{
		return $this->code;
	}

	public function get_error_data()
	{
		return $this->data;
	}
}

class WP_REST_Response
{
	private $data;

	public function __construct($data)
	{
		$this->data = $data;
	}

	public function get_data()
	{
		return $this->data;
	}
}

class WP_REST_Request
{
	private $body;
	private $params;
	private $headers;

	public function __construct($body = '', $params = array(), $headers = array())
	{
		$this->body = $body;
		$this->params = $params;
		$this->headers = array_change_key_case($headers, CASE_LOWER);
	}

	public function get_body()
	{
		return $this->body;
	}

	public function get_json_params()
	{
		return $this->params;
	}

	public function get_header($key)
	{
		$key = strtolower($key);
		return isset($this->headers[$key]) ? $this->headers[$key] : '';
	}
}

class Npcink_Device_Inventory_Observation_Ingest_Service
{
	public $calls = 0;

	public function ingest($params)
	{
		$this->calls++;
		return array('data' => array('accepted' => true));
	}
}

class Npcink_Device_Inventory_V3_Tables
{
	public static $options = array();

	public static function options()
	{
		return self::$options;
	}
}

$npcink_upload_transients = array();

function sanitize_key($value)
{
	return strtolower(preg_replace('/[^a-zA-Z0-9_\-]/', '', (string) $value));
}

function sanitize_text_field($value)
{
	return trim((string) $value);
}

function is_wp_error($value)
{
	return $value instanceof WP_Error;
}

function rest_ensure_response($value)
{
	return $value instanceof WP_REST_Response ? $value : new WP_REST_Response($value);
}

function get_transient($key)
{
	global $npcink_upload_transients;
	return isset($npcink_upload_transients[$key]) ? $npcink_upload_transients[$key] : false;
}

function set_transient($key, $value, $expiration = 0)
{
	global $npcink_upload_transients;
	$npcink_upload_transients[$key] = $value;
	return true;
}

function wp_rand($min = 0, $max = 0)
{
	return $max > 0 ? $max : $min;
}

function current_user_can($capability)
{
	return false;
}

function register_rest_route($namespace, $route, $args)
{
	return true;
}

require_once __DIR__ . '/../includes/v3/class-npcink-device-inventory-v3-response.php';
require_once __DIR__ . '/../includes/v3/services/class-npcink-device-inventory-token-auth-service.php';
require_once __DIR__ . '/../includes/v3/rest/class-npcink-device-inventory-device-observations-controller.php';

function npcink_upload_assert($condition, $message)
{
	if (!$condition) {
		fwrite(STDERR, "Device upload fixture failed: {$message}\n");
		exit(1);
	}
}

function npcink_upload_error_code($result)
{
	npcink_upload_assert(is_wp_error($result), 'expected WP_Error result');
	return $result->get_error_code();
}

$ingest = new Npcink_Device_Inventory_Observation_Ingest_Service();
$auth = new Npcink_Device_Inventory_Token_Auth_Service();
$controller = new Npcink_Device_Inventory_Device_Observations_Controller($ingest, $auth);

$oversized = new WP_REST_Request('', array(), array('content-length' => Npcink_Device_Inventory_Device_Observations_Controller::MAX_BODY_BYTES + 1));
npcink_upload_assert(npcink_upload_error_code($controller->create_item($oversized)) === 'observation_too_large', 'content-length limit must reject early');

$too_many_items = array_fill(0, Npcink_Device_Inventory_Device_Observations_Controller::MAX_ARRAY_ITEMS + 1, 1);
$complex = new WP_REST_Request(json_encode($too_many_items), $too_many_items);
npcink_upload_assert(npcink_upload_error_code($controller->create_item($complex)) === 'observation_too_complex', 'array item limit must be enforced');

$too_long = str_repeat('x', Npcink_Device_Inventory_Device_Observations_Controller::MAX_STRING_BYTES + 1);
$string_request = new WP_REST_Request(json_encode(array('value' => $too_long)), array('value' => $too_long));
npcink_upload_assert(npcink_upload_error_code($controller->create_item($string_request)) === 'observation_string_too_large', 'string byte limit must be enforced');
npcink_upload_assert($ingest->calls === 0, 'rejected payloads must not reach ingest');

$valid = new WP_REST_Request('{"summary":{"hostname":"demo"}}', array('summary' => array('hostname' => 'demo')));
$valid_response = $controller->create_item($valid);
npcink_upload_assert($valid_response instanceof WP_REST_Response && $ingest->calls === 1, 'valid payload must reach ingest once');

$token_id = 'agent-1';
$secret = 'test-secret';
Npcink_Device_Inventory_V3_Tables::$options = array(
	'client_tokens' => array(array('id' => $token_id, 'secret' => $secret, 'enabled' => true)),
);
$timestamp = (string) time();
$body = '{"summary":{"hostname":"demo"}}';
$replay_token_id = 'replay-agent';
$replay_secret = 'replay-secret';
Npcink_Device_Inventory_V3_Tables::$options['client_tokens'][] = array('id' => $replay_token_id, 'secret' => $replay_secret, 'enabled' => true);
$replay_nonce = 'replay-nonce';
$replay_payload = $timestamp . "\n" . $replay_nonce . "\n" . hash('sha256', $body);
$replay_signature = 'sha256=' . hash_hmac('sha256', $replay_payload, $replay_secret);
$replay_request = new WP_REST_Request(
	$body,
	array(),
	array(
		'x-npcink-device-token-id' => $replay_token_id,
		'x-npcink-device-timestamp' => $timestamp,
		'x-npcink-device-nonce' => $replay_nonce,
		'x-npcink-device-signature' => $replay_signature,
	)
);
npcink_upload_assert($auth->verify_request($replay_request) === true, 'first use of a nonce must pass');
npcink_upload_assert(npcink_upload_error_code($auth->verify_request($replay_request)) === 'replayed_nonce', 'nonce replay must be rejected');

for ($index = 0; $index < Npcink_Device_Inventory_Token_Auth_Service::RATE_LIMIT; $index++) {
	$nonce = 'nonce-' . $index;
	$payload = $timestamp . "\n" . $nonce . "\n" . hash('sha256', $body);
	$signature = 'sha256=' . hash_hmac('sha256', $payload, $secret);
	$request = new WP_REST_Request(
		$body,
		array(),
		array(
			'x-npcink-device-token-id' => $token_id,
			'x-npcink-device-timestamp' => $timestamp,
			'x-npcink-device-nonce' => $nonce,
			'x-npcink-device-signature' => $signature,
		)
	);
	npcink_upload_assert($auth->verify_request($request) === true, 'signed request within rate limit must pass');
}
$nonce = 'nonce-over-limit';
$payload = $timestamp . "\n" . $nonce . "\n" . hash('sha256', $body);
$signature = 'sha256=' . hash_hmac('sha256', $payload, $secret);
$limited = $auth->verify_request(
	new WP_REST_Request(
		$body,
		array(),
		array(
			'x-npcink-device-token-id' => $token_id,
			'x-npcink-device-timestamp' => $timestamp,
			'x-npcink-device-nonce' => $nonce,
			'x-npcink-device-signature' => $signature,
		)
	)
);
npcink_upload_assert(npcink_upload_error_code($limited) === 'upload_rate_limited', '121st request in a window must be rate limited');
npcink_upload_assert(isset($limited->get_error_data()['details']['details']['retryAfter']), 'rate limit error must expose retryAfter');

echo "Device upload boundary fixture checks passed.\n";
