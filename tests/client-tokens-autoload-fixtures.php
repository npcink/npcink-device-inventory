<?php

define('ABSPATH', __DIR__ . '/');

function wp_json_encode($value)
{
	return json_encode($value);
}

$npcink_options = array();
$npcink_option_autoload = array();
$npcink_alloptions = array();

function npcink_autoload_enabled($autoload)
{
	return !in_array($autoload, array(false, 'no', 'off', 'auto-off'), true);
}

function get_option($name, $default = false)
{
	global $npcink_options;
	return array_key_exists($name, $npcink_options) ? $npcink_options[$name] : $default;
}

function add_option($name, $value, $deprecated = '', $autoload = true)
{
	global $npcink_options, $npcink_option_autoload, $npcink_alloptions;
	if (array_key_exists($name, $npcink_options)) {
		return false;
	}
	$npcink_options[$name] = $value;
	$npcink_option_autoload[$name] = $autoload;
	if (npcink_autoload_enabled($autoload)) {
		$npcink_alloptions[$name] = $value;
	} else {
		unset($npcink_alloptions[$name]);
	}
	return true;
}

function update_option($name, $value, $autoload = null)
{
	global $npcink_options, $npcink_option_autoload, $npcink_alloptions;
	if (!array_key_exists($name, $npcink_options)) {
		return add_option($name, $value, '', $autoload === null ? true : $autoload);
	}
	$npcink_options[$name] = $value;
	if ($autoload !== null) {
		$npcink_option_autoload[$name] = $autoload;
	}
	$current_autoload = array_key_exists($name, $npcink_option_autoload) ? $npcink_option_autoload[$name] : true;
	if (npcink_autoload_enabled($current_autoload)) {
		$npcink_alloptions[$name] = $value;
	} else {
		unset($npcink_alloptions[$name]);
	}
	return true;
}

function wp_load_alloptions()
{
	global $npcink_alloptions;
	return $npcink_alloptions;
}

function wp_set_option_autoload($name, $autoload)
{
	global $npcink_options, $npcink_option_autoload, $npcink_alloptions;
	$npcink_option_autoload[$name] = $autoload;
	if (npcink_autoload_enabled($autoload) && array_key_exists($name, $npcink_options)) {
		$npcink_alloptions[$name] = $npcink_options[$name];
	} else {
		unset($npcink_alloptions[$name]);
	}
	return true;
}

require_once __DIR__ . '/../includes/v3/class-npcink-device-inventory-v3-tables.php';

function npcink_assert($condition, $message)
{
	if (!$condition) {
		throw new RuntimeException($message);
	}
}

$secret = 'fixture-client-secret';
$npcink_options[Npcink_Device_Inventory_V3_Tables::OPTION] = array(
	'client_tokens' => array(
		array(
			'id' => 'tok1',
			'secret' => $secret,
			'enabled' => true,
		),
	),
	'asset_number_prefix' => 'A',
	'delete_data_on_uninstall' => false,
);
$npcink_option_autoload[Npcink_Device_Inventory_V3_Tables::OPTION] = true;
$npcink_alloptions[Npcink_Device_Inventory_V3_Tables::OPTION] = $npcink_options[Npcink_Device_Inventory_V3_Tables::OPTION];

$tokens = Npcink_Device_Inventory_V3_Tables::client_tokens();
$main = get_option(Npcink_Device_Inventory_V3_Tables::OPTION);
$stored = get_option(Npcink_Device_Inventory_V3_Tables::CLIENT_TOKENS_OPTION);
$alloptions = wp_load_alloptions();
npcink_assert(isset($tokens[0]['secret']) && $tokens[0]['secret'] === $secret, 'Legacy client token secret was lost during migration.');
npcink_assert(!isset($main['client_tokens']), 'Legacy client tokens remained in the autoloaded options blob.');
npcink_assert($main['asset_number_prefix'] === 'A', 'Non-secret settings were lost during token migration.');
npcink_assert(isset($stored[0]['secret']) && $stored[0]['secret'] === $secret, 'Migrated tokens were not stored in the dedicated option.');
npcink_assert(!npcink_autoload_enabled($npcink_option_autoload[Npcink_Device_Inventory_V3_Tables::CLIENT_TOKENS_OPTION]), 'Migrated client token option was autoloaded.');
npcink_assert(!isset($alloptions[Npcink_Device_Inventory_V3_Tables::CLIENT_TOKENS_OPTION]), 'Client token option was present in alloptions after migration.');
npcink_assert(strpos(wp_json_encode($alloptions), $secret) === false, 'Client token secret was visible in autoloaded options.');

Npcink_Device_Inventory_V3_Tables::update_options(array_merge(
	Npcink_Device_Inventory_V3_Tables::options(),
	array(
		'client_tokens' => $tokens,
		'asset_number_prefix' => 'B',
	)
));
$main = get_option(Npcink_Device_Inventory_V3_Tables::OPTION);
npcink_assert(!isset($main['client_tokens']), 'A later settings write copied tokens back into the autoloaded option.');
npcink_assert($main['asset_number_prefix'] === 'B', 'Settings updates no longer persist after token migration.');
npcink_assert(Npcink_Device_Inventory_V3_Tables::client_tokens()[0]['secret'] === $secret, 'A later settings write dropped the migrated token.');

$tokens[] = array(
	'id' => 'tok2',
	'secret' => 'second-secret',
	'enabled' => true,
);
Npcink_Device_Inventory_V3_Tables::update_client_tokens($tokens);
$alloptions = wp_load_alloptions();
npcink_assert(count(Npcink_Device_Inventory_V3_Tables::client_tokens()) === 2, 'Creating a token did not persist the dedicated option.');
npcink_assert(!isset(get_option(Npcink_Device_Inventory_V3_Tables::OPTION)['client_tokens']), 'Creating a token wrote secrets back into the autoloaded option.');
npcink_assert(!isset($alloptions[Npcink_Device_Inventory_V3_Tables::CLIENT_TOKENS_OPTION]), 'A newly written client token option was autoloaded.');
npcink_assert(strpos(wp_json_encode($alloptions), 'second-secret') === false, 'A newly created token secret was visible in autoloaded options.');

$npcink_options = array(
	Npcink_Device_Inventory_V3_Tables::OPTION => array('asset_number_prefix' => 'C'),
	Npcink_Device_Inventory_V3_Tables::CLIENT_TOKENS_OPTION => array(
		array(
			'id' => 'tok3',
			'secret' => 'repaired-secret',
			'enabled' => true,
		),
	),
);
$npcink_option_autoload = array(
	Npcink_Device_Inventory_V3_Tables::OPTION => true,
	Npcink_Device_Inventory_V3_Tables::CLIENT_TOKENS_OPTION => true,
);
$npcink_alloptions = $npcink_options;
Npcink_Device_Inventory_V3_Tables::migrate_client_tokens();
$alloptions = wp_load_alloptions();
npcink_assert(Npcink_Device_Inventory_V3_Tables::client_tokens()[0]['secret'] === 'repaired-secret', 'An already-split token option was lost while repairing autoload.');
npcink_assert(!isset($alloptions[Npcink_Device_Inventory_V3_Tables::CLIENT_TOKENS_OPTION]), 'An autoloaded client token option was not repaired.');
npcink_assert(strpos(wp_json_encode($alloptions), 'repaired-secret') === false, 'A repaired token secret remained visible in autoloaded options.');

echo "Client token autoload fixtures passed.\n";
