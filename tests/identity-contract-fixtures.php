<?php

define('ABSPATH', __DIR__ . '/');

function sanitize_text_field($value)
{
	return trim((string) $value);
}

require_once __DIR__ . '/../includes/v3/services/class-npcink-device-inventory-device-identity-service.php';

function npcink_identity_assert($condition, $message)
{
	if (!$condition) {
		fwrite(STDERR, "Identity contract fixture failed: {$message}\n");
		exit(1);
	}
}

$service = new Npcink_Device_Inventory_Device_Identity_Service();
$canonical_observation = array(
	'_npcink_device' => array(
		'device_uuid_v1' => 'client-value-must-not-be-trusted',
		'fallback_device_v1' => 'client-fallback-must-not-be-trusted',
	),
	'asset' => array(
		'identity' => array('device_uuid_v1' => 'another-client-value'),
		'hardware' => array(
			'hardwareUuid' => ' BOARD-UUID ',
			'system' => array('uuid' => ' BOARD-UUID '),
			'processors' => array(array('name' => ' Example CPU ', 'processorId' => 'SHARED-CPU-ID')),
			'baseboard' => array(
				'manufacturer' => ' Example  Inc ',
				'product' => 'Board Pro',
				'serial' => 'BOARD-001',
			),
			'network' => array(
				'primary' => array('mac' => 'aa:bb:cc:dd:ee:01', 'virtual' => false, 'internal' => false),
				'identityInterfaces' => array(
					array('pnpDeviceId' => 'PCI\\VEN_1234', 'permanentAddress' => 'AA-BB-CC-DD-EE-01', 'virtual' => false),
				),
			),
		),
	),
);
$identities = $service->identities($canonical_observation);
npcink_identity_assert(count($identities) === 3, 'all independent v2 hardware signals must be retained');
npcink_identity_assert($identities[0]['type'] === 'system_uuid_v2', 'system UUID must be the primary identity');
npcink_identity_assert($identities[0]['value'] === 'system-v2-fafa4bc231d7a48614a0bfd9e0ac3', 'PHP system identity must match the Rust contract');
npcink_identity_assert($identities[1]['value'] === 'board-v2-13d1184332c87ed6ea9c461d7c270', 'PHP board identity must match the Rust contract');
npcink_identity_assert($identities[2]['value'] === 'pci-v2-9cd7c81afd4a5c0f01e33532ec11a', 'PHP PCI identity must match the Rust contract');
npcink_identity_assert($identities[0]['value'] !== 'client-value-must-not-be-trusted', 'client-declared identity must be ignored');

$legacy = $service->legacy_primary_identity($canonical_observation);
npcink_identity_assert($legacy['type'] === 'device_uuid_v1', 'the one-time transition lookup must retain the v1 canonical algorithm');
npcink_identity_assert($legacy['value'] === 'device-v1-8c8a3dad23be3fc4e958ca4c94cea', 'the legacy lookup must remain byte-compatible');

$fallback_observation = array(
	'asset' => array(
		'hardware' => array(
			'hardwareUuid' => '03000200-0400-0500-0006-000700080009',
			'baseboard' => array('manufacturer' => 'KOLOE', 'product' => 'H610M4-PLUS', 'serial' => 'Default string'),
			'processors' => array(array('name' => '12th Gen Intel Core i5', 'processorId' => 'SHARED-CPU-ID')),
			'network' => array(
				'primary' => array('mac' => 'aa:bb:cc:dd:ee:01', 'virtual' => false, 'internal' => false),
				'identityInterfaces' => array(
					array('pnpDeviceId' => 'PCI\\VEN_10EC', 'permanentAddress' => '00E01E84A499', 'macAddress' => '00-E0-1E-84-A4-98', 'virtual' => false),
				),
			),
		),
	),
);
$fallback = $service->primary_identity($fallback_observation);
npcink_identity_assert($fallback['type'] === 'pci_permanent_mac_v2', 'permanent PCI MAC fallback must be used when strong facts are invalid');

$different_mac = $fallback_observation;
$different_mac['asset']['hardware']['network']['identityInterfaces'][0]['permanentAddress'] = '00E01E84A498';
npcink_identity_assert($service->primary_identity($different_mac)['value'] !== $fallback['value'], 'permanent PCI MAC must separate fallback devices');

$usb_only = $fallback_observation;
$usb_only['asset']['hardware']['network']['identityInterfaces'][0]['pnpDeviceId'] = 'USB\\VID_1234';
$missing = $service->primary_identity($usb_only);
npcink_identity_assert($missing['type'] === '' && $missing['value'] === '', 'a USB MAC must not produce an identity');

$current_only = $fallback_observation;
$current_only['asset']['hardware']['network']['identityInterfaces'][0]['permanentAddress'] = '';
npcink_identity_assert($service->primary_identity($current_only)['type'] === '', 'a current-only MAC must remain a manual candidate');

$invalid_fixture = json_decode(file_get_contents(__DIR__ . '/fixtures/device-identity-invalid-values.json'), true);
npcink_identity_assert(is_array($invalid_fixture) && !empty($invalid_fixture['invalidValues']), 'shared invalid identity fixture must load');
foreach ($invalid_fixture['invalidValues'] as $invalid_value) {
	$invalid_canonical = $canonical_observation;
	$invalid_canonical['asset']['hardware']['hardwareUuid'] = $invalid_value;
	$invalid_canonical['asset']['hardware']['system']['uuid'] = $invalid_value;
	npcink_identity_assert(
		$service->identities($invalid_canonical)[0]['type'] === 'baseboard_serial_v2',
		'PHP system identity must reject shared invalid value without discarding a valid board identity: ' . $invalid_value
	);

	$invalid_fallback = $fallback_observation;
	$invalid_fallback['asset']['hardware']['network']['identityInterfaces'][0]['permanentAddress'] = $invalid_value;
	npcink_identity_assert(
		$service->primary_identity($invalid_fallback)['value'] === '',
		'PHP PCI fallback must reject shared invalid value: ' . $invalid_value
	);
}

echo "Identity contract fixture checks passed.\n";
