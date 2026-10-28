<?php

if (!defined('ABSPATH')) {
	exit;
}

class Npcink_Device_Inventory_Device_Identity_Service
{
	private const MAX_PCI_IDENTITIES = 8;
	public const TYPE = 'system_uuid_v2';
	public const BOARD_TYPE = 'baseboard_serial_v2';
	public const FALLBACK_TYPE = 'pci_permanent_mac_v2';

	public function primary_identity($payload)
	{
		$identities = $this->identities($payload);
		if (!empty($identities)) {
			return $identities[0];
		}

		return array(
			'type' => '',
			'value' => '',
			'reason' => 'missing_system_uuid_board_serial_or_permanent_pci_mac',
		);
	}

	public function identities($payload)
	{
		$asset = is_array($payload) && isset($payload['asset']) && is_array($payload['asset']) ? $payload['asset'] : array();
		$hardware = isset($asset['hardware']) && is_array($asset['hardware']) ? $asset['hardware'] : array();
		$system = isset($hardware['system']) && is_array($hardware['system']) ? $hardware['system'] : array();
		$baseboard = isset($hardware['baseboard']) && is_array($hardware['baseboard']) ? $hardware['baseboard'] : array();
		$identities = array();

		$system_uuid = $this->value(isset($hardware['hardwareUuid']) ? $hardware['hardwareUuid'] : '');
		if ($system_uuid === '') {
			$system_uuid = $this->value(isset($system['uuid']) ? $system['uuid'] : '');
		}
		if ($system_uuid !== '') {
			$identities[] = $this->identity(self::TYPE, 'system-v2', 'system_uuid=' . $system_uuid, 100);
		}

		$manufacturer = $this->value(isset($baseboard['manufacturer']) ? $baseboard['manufacturer'] : '');
		$model = $this->value(isset($baseboard['product']) ? $baseboard['product'] : (isset($baseboard['model']) ? $baseboard['model'] : ''));
		$serial = $this->value(isset($baseboard['serial']) ? $baseboard['serial'] : (isset($baseboard['serialNumber']) ? $baseboard['serialNumber'] : ''));
		if ($manufacturer !== '' && $model !== '' && $serial !== '') {
			$identities[] = $this->identity(
				self::BOARD_TYPE,
				'board-v2',
				'baseboard_manufacturer=' . $manufacturer . '|baseboard_model=' . $model . '|baseboard_serial=' . $serial,
				100
			);
		}

		$cpu_model = $this->processor_model($hardware);
		if ($manufacturer !== '' && $model !== '' && $cpu_model !== '') {
			foreach ($this->permanent_pci_macs($hardware) as $mac) {
				$identities[] = $this->identity(
					self::FALLBACK_TYPE,
					'pci-v2',
					'pci_permanent_mac=' . $mac . '|baseboard_manufacturer=' . $manufacturer . '|baseboard_model=' . $model . '|cpu_model=' . $cpu_model,
					80
				);
			}
		}

		return $identities;
	}

	private function identity($type, $prefix, $source, $confidence)
	{
		return array(
			'type' => $type,
			'value' => $prefix . '-' . substr(hash('sha256', $source), 0, 29),
			'confidence' => $confidence,
			'source' => 'server_recomputed',
		);
	}

	private function processor_model($hardware)
	{
		$models = array();
		$processors = isset($hardware['processors']) && is_array($hardware['processors']) ? $hardware['processors'] : array();
		foreach ($processors as $processor) {
			if (is_array($processor)) {
				$model = $this->value(isset($processor['name']) ? $processor['name'] : '');
				if ($model !== '') {
					$models[] = $model;
				}
			}
		}
		if (empty($models)) {
			$cpu = isset($hardware['cpu']) && is_array($hardware['cpu']) ? $hardware['cpu'] : array();
			$model = $this->value(isset($cpu['brand']) ? $cpu['brand'] : '');
			if ($model !== '') {
				$models[] = $model;
			}
		}
		$models = array_values(array_unique($models));
		sort($models, SORT_STRING);
		return implode('+', $models);
	}

	private function permanent_pci_macs($hardware)
	{
		$network = isset($hardware['network']) && is_array($hardware['network']) ? $hardware['network'] : array();
		$interfaces = isset($network['identityInterfaces']) && is_array($network['identityInterfaces']) ? $network['identityInterfaces'] : array();
		$macs = array();
		foreach ($interfaces as $interface) {
			if (!is_array($interface) || !empty($interface['virtual'])) {
				continue;
			}
			$pnp = isset($interface['pnpDeviceId']) && is_scalar($interface['pnpDeviceId']) ? strtoupper(trim((string) $interface['pnpDeviceId'])) : '';
			if (strpos($pnp, 'PCI\\') !== 0) {
				continue;
			}
			$mac = $this->mac(isset($interface['permanentAddress']) ? $interface['permanentAddress'] : '');
			if ($mac !== '') {
				$macs[] = $mac;
			}
		}
		$macs = array_values(array_unique($macs));
		sort($macs, SORT_STRING);
		return array_slice($macs, 0, self::MAX_PCI_IDENTITIES);
	}

	private function mac($value)
	{
		if (!is_scalar($value)) {
			return '';
		}
		$compact = strtolower(preg_replace('/[^0-9a-f]/i', '', trim((string) $value)));
		if (strlen($compact) !== 12 || preg_match('/^0+$/', $compact) || preg_match('/^f+$/', $compact)) {
			return '';
		}
		return implode(':', str_split($compact, 2));
	}

	private function value($value)
	{
		if (!is_scalar($value)) {
			return '';
		}
		$value = preg_replace('/\s+/', ' ', strtolower(trim((string) $value)));
		$invalid = array(
			'',
			'0',
			'00000000',
			'00000000-0000-0000-0000-000000000000',
			'03000200-0400-0500-0006-000700080009',
			'ffffffff',
			'ffffffff-ffff-ffff-ffff-ffffffffffff',
			'xxxxxxxx',
			'default string',
			'n/a',
			'na',
			'invalid',
			'undefined',
			'not applicable',
			'to be filled by o.e.m.',
			'to be filled by oem',
			'not filled by o.e.m.',
			'none',
			'null',
			'not specified',
			'not available',
			'not present',
			'not provided',
			'not set',
			'unknown',
			'system serial number',
			'-',
		);
		$compact = preg_replace('/[^a-z0-9]/', '', $value);
		if (
			in_array($value, $invalid, true)
			|| $compact === ''
			|| preg_match('/^0+$/', $compact)
			|| preg_match('/^x+$/', $compact)
			|| (strlen($compact) >= 8 && preg_match('/^f+$/', $compact))
		) {
			return '';
		}
		return $value;
	}
}
