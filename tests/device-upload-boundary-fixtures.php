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
	private $method;
	private $route;
	private $query;

	public function __construct($body = '', $params = array(), $headers = array(), $method = 'POST', $route = '/npcink-device-inventory/v1/device-observations', $query = array())
	{
		$this->body = $body;
		$this->method = $method;
		$this->route = $route;
		$this->query = $query;
		$this->params = $params;
		$this->headers = array_change_key_case($headers, CASE_LOWER);
	}

	public function get_method() { return $this->method; }
	public function get_route() { return $this->route; }
	public function get_query_params() { return $this->query; }

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

$npcink_upload_clock = time();
$npcink_upload_object_cache = false;
$npcink_upload_cache = array();

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

function wp_using_ext_object_cache() { global $npcink_upload_object_cache; return $npcink_upload_object_cache; }
function wp_cache_add($key, $value, $group, $ttl)
{
	global $npcink_upload_clock, $npcink_upload_cache;
	if (isset($npcink_upload_cache[$key]) && $npcink_upload_cache[$key] > $npcink_upload_clock) { return false; }
	$npcink_upload_cache[$key] = $npcink_upload_clock + $ttl;
	return true;
}
class Npcink_Upload_Test_Auth extends Npcink_Device_Inventory_Token_Auth_Service
{
	protected function now() { global $npcink_upload_clock; return $npcink_upload_clock; }
}
class Npcink_Upload_Nonce_Db
{
	public $options = 'wp_options';
	public function esc_like($value) { return addcslashes($value, '_%\\'); }
	public $claims = array();
	public $counters = array();
	private $last_count = 0;
	public function prepare($query, ...$args) { return array($query, $args); }
	public function query($prepared)
	{
		list($query, $args) = $prepared;
		if (strpos($query, 'ON DUPLICATE KEY UPDATE') !== false) {
			list($key, $expires, $now) = $args;
			if (isset($this->claims[$key]) && $this->claims[$key] >= $now) { return 0; }
			$this->claims[$key] = (int) $expires;
		}
		if (strpos($query, 'INSERT IGNORE') !== false) {
			if (!isset($this->counters[$args[0]])) { $this->counters[$args[0]] = 0; }
		} elseif (strpos($query, 'UPDATE') === 0) {
			$this->last_count = $this->counters[$args[2]] = min($args[1], $this->counters[$args[2]] + 1);
		}
		return 1;
	}
	public function get_var($query) { return $this->last_count; }
}
$wpdb = new Npcink_Upload_Nonce_Db();
$ingest = new Npcink_Device_Inventory_Observation_Ingest_Service();
$auth = new Npcink_Upload_Test_Auth();
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

$prefix = str_repeat('a', 128);
$colliding_keys = array($prefix . '1' => 'first', $prefix . '2' => 'second');
npcink_upload_assert(npcink_upload_error_code($controller->create_item(new WP_REST_Request(json_encode($colliding_keys), $colliding_keys))) === 'observation_key_too_large', 'long keys must be rejected rather than truncated into a collision');
npcink_upload_assert($ingest->calls === 0, 'invalid keys must not reach storage');

$valid = new WP_REST_Request('{"summary":{"hostname":"demo"}}', array('summary' => array('hostname' => 'demo')));
$valid_response = $controller->create_item($valid);
npcink_upload_assert($valid_response instanceof WP_REST_Response && $ingest->calls === 1, 'valid payload must reach ingest once');

// USB hubs and platform reports contain real nested hardware beyond the old depth.
$nested_hardware = array('hardwareFact' => false, 'zeroFact' => 0);
for ($level = 0; $level < 16; $level++) {
	$nested_hardware = array('children' => $nested_hardware);
}
$complete = array('asset' => array('hardware' => array('platformData' => $nested_hardware)));
$complete_request = new WP_REST_Request(json_encode($complete), $complete);
npcink_upload_assert($controller->create_item($complete_request) instanceof WP_REST_Response, 'complete nested hardware must reach ingest');
$too_deep = $nested_hardware;
for ($level = 0; $level < Npcink_Device_Inventory_Device_Observations_Controller::MAX_DEPTH; $level++) {
	$too_deep = array('children' => $too_deep);
}
npcink_upload_assert(npcink_upload_error_code($controller->create_item(new WP_REST_Request(json_encode($too_deep), $too_deep))) === 'observation_too_complex', 'expanded hardware depth must remain bounded');
$too_many_nodes = array_fill(0, 50, array_fill(0, 500, 0));
npcink_upload_assert(npcink_upload_error_code($controller->create_item(new WP_REST_Request(json_encode($too_many_nodes), $too_many_nodes))) === 'observation_too_complex', 'expanded hardware node count must remain bounded');

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
$replay_payload = "npcink-device-upload-v2\nPOST\n/npcink-device-inventory/v1/device-observations\n" . $replay_token_id . "\n" . $timestamp . "\n" . $replay_nonce . "\n" . hash('sha256', $body);
$replay_signature = 'sha256=' . hash_hmac('sha256', $replay_payload, $replay_secret);
$replay_request = new WP_REST_Request(
	$body,
	array(),
	array(
		'x-npcink-device-signature-version' => '2',
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
	$payload = "npcink-device-upload-v2\nPOST\n/npcink-device-inventory/v1/device-observations\n" . $token_id . "\n" . $timestamp . "\n" . $nonce . "\n" . hash('sha256', $body);
	$signature = 'sha256=' . hash_hmac('sha256', $payload, $secret);
	$request = new WP_REST_Request(
		$body,
		array(),
		array(
			'x-npcink-device-signature-version' => '2',
			'x-npcink-device-token-id' => $token_id,
			'x-npcink-device-timestamp' => $timestamp,
			'x-npcink-device-nonce' => $nonce,
			'x-npcink-device-signature' => $signature,
		)
	);
	npcink_upload_assert($auth->verify_request($request) === true, 'signed request within rate limit must pass');
}
$nonce = 'nonce-over-limit';
$payload = "npcink-device-upload-v2\nPOST\n/npcink-device-inventory/v1/device-observations\n" . $token_id . "\n" . $timestamp . "\n" . $nonce . "\n" . hash('sha256', $body);
$signature = 'sha256=' . hash_hmac('sha256', $payload, $secret);
$limited = $auth->verify_request(
	new WP_REST_Request(
		$body,
		array(),
		array(
			'x-npcink-device-signature-version' => '2',
			'x-npcink-device-token-id' => $token_id,
			'x-npcink-device-timestamp' => $timestamp,
			'x-npcink-device-nonce' => $nonce,
			'x-npcink-device-signature' => $signature,
		)
	)
);
npcink_upload_assert(npcink_upload_error_code($limited) === 'upload_rate_limited', '121st request in a window must be rate limited');
npcink_upload_assert(isset($limited->get_error_data()['details']['details']['retryAfter']), 'rate limit error must expose retryAfter');

// The most future-dated accepted signature remains valid at t + 600.
foreach (array('object-cache', 'database') as $backend) {
	$npcink_upload_clock = time();
	$npcink_upload_object_cache = $backend === 'object-cache';
	$wpdb = new Npcink_Upload_Nonce_Db();
	$future_timestamp = (string) ($npcink_upload_clock + 300);
	$future_nonce = 'future-' . $backend;
	$payload = "npcink-device-upload-v2\nPOST\n/npcink-device-inventory/v1/device-observations\n" . $replay_token_id . "\n" . $future_timestamp . "\n" . $future_nonce . "\n" . hash('sha256', $body);
	$future_request = new WP_REST_Request($body, array(), array(
		'x-npcink-device-signature-version' => '2',
		'x-npcink-device-token-id' => $replay_token_id,
		'x-npcink-device-timestamp' => $future_timestamp,
		'x-npcink-device-nonce' => $future_nonce,
		'x-npcink-device-signature' => 'sha256=' . hash_hmac('sha256', $payload, $replay_secret),
	));
	npcink_upload_assert($auth->verify_request($future_request) === true, $backend . ': future signature within tolerance must pass once');
	$npcink_upload_clock += 301;
	npcink_upload_assert(npcink_upload_error_code($auth->verify_request($future_request)) === 'replayed_nonce', $backend . ': replay after five minutes must fail');
	$npcink_upload_clock += 299;
	npcink_upload_assert(npcink_upload_error_code($auth->verify_request($future_request)) === 'replayed_nonce', $backend . ': inclusive signature boundary must still reject replay');
	$npcink_upload_clock++;
	npcink_upload_assert(npcink_upload_error_code($auth->verify_request($future_request)) === 'expired_signature', $backend . ': expired signature must fail after nonce expiry');
}

// Shared independent golden vectors prove both languages sign the same raw bytes.
$goldens = json_decode(file_get_contents(__DIR__ . '/fixtures/device-signature-v2.json'), true);
foreach ($goldens as $golden) {
	$npcink_upload_clock = (int) $golden['timestamp'];
	$npcink_upload_object_cache = true;
	$npcink_upload_cache = array();
	Npcink_Device_Inventory_V3_Tables::$options['client_tokens'] = array(
		array('id' => $golden['token_id'], 'secret' => $golden['secret'], 'enabled' => true),
		array('id' => 'same-secret-other-id', 'secret' => $golden['secret'], 'enabled' => true),
	);
	$headers = array(
		'x-npcink-device-signature-version' => '2',
		'x-npcink-device-token-id' => $golden['token_id'],
		'x-npcink-device-timestamp' => $golden['timestamp'],
		'x-npcink-device-nonce' => $golden['nonce'],
		'x-npcink-device-signature' => $golden['signature'],
	);
	npcink_upload_assert(hash('sha256', $golden['body']) === $golden['body_hash'], 'golden body byte hash changed');
	npcink_upload_assert('sha256=' . hash_hmac('sha256', $golden['payload'], $golden['secret']) === $golden['signature'], 'golden HMAC changed');
	$make_request = static function ($body, $headers, $method, $route, $query = array()) { return new WP_REST_Request($body, array(), $headers, $method, $route, $query); };
	$base = array($golden['body'], $headers, $golden['method'], $golden['route']);
	$old = $headers;
	unset($old['x-npcink-device-signature-version']);
	npcink_upload_assert(npcink_upload_error_code($auth->verify_request($make_request($golden['body'], $old, $golden['method'], $golden['route']))) === 'unsupported_signature_version', 'old signatures must fail without consuming nonce');
	$swapped = $headers;
	$swapped['x-npcink-device-token-id'] = 'same-secret-other-id';
	npcink_upload_assert(npcink_upload_error_code($auth->verify_request($make_request($golden['body'], $swapped, $golden['method'], $golden['route']))) === 'invalid_signature', 'token id is signed even when secrets coincide');
	npcink_upload_assert(npcink_upload_error_code($auth->verify_request($make_request($golden['body'] . ' ', $headers, $golden['method'], $golden['route']))) === 'invalid_signature', 'raw body whitespace is signed');
	$other_method = $golden['method'] === 'POST' ? 'GET' : 'POST';
	$other_route = Npcink_Device_Inventory_Token_Auth_Service::OBSERVATION_ROUTE . ($other_method === 'GET' ? '/verify' : '');
	npcink_upload_assert(npcink_upload_error_code($auth->verify_request($make_request($golden['body'], $headers, $other_method, $other_route))) === 'invalid_signature', 'signature cannot move between authorized operations');
	npcink_upload_assert(npcink_upload_error_code($auth->verify_request($make_request($golden['body'], $headers, 'DELETE', $golden['route']))) === 'token_scope_denied', 'unexpected method is out of scope');
	npcink_upload_assert(npcink_upload_error_code($auth->verify_request($make_request($golden['body'], $headers, 'POST', '/npcink-device-inventory/v1/assets'))) === 'token_scope_denied', 'asset management is out of token scope');
	npcink_upload_assert(npcink_upload_error_code($auth->verify_request($make_request($golden['body'], $headers, $golden['method'], $golden['route'], array('extra' => '1')))) === 'unsigned_query_parameters', 'unsigned query cannot affect request behavior');
	$bad_nonce = $headers;
	$bad_nonce['x-npcink-device-nonce'] .= "\n";
	npcink_upload_assert(npcink_upload_error_code($auth->verify_request($make_request($golden['body'], $bad_nonce, $golden['method'], $golden['route']))) === 'invalid_signature_headers', 'headers are validated without destructive normalization');
	$valid = $make_request(...$base);
	npcink_upload_assert($auth->verify_request($valid) === true, 'golden request must pass after invalid attempts');
	npcink_upload_assert(npcink_upload_error_code($auth->verify_request($valid)) === 'replayed_nonce', 'golden nonce is claimed atomically');
}
echo "Device upload boundary fixture checks passed.\n";
