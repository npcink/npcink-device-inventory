<?php

define('ABSPATH', __DIR__ . '/');

class Npcink_Device_Inventory_Admin_Interface
{
	protected static $table_assets_name = 'npcink_assets';
	protected static $table_asset_identities_name = 'npcink_asset_identities';
	protected static $table_asset_observations_name = 'npcink_asset_observations';
	protected static $table_asset_events_name = 'npcink_asset_events';
}

class Npcink_Schema_Migration_Fake_Wpdb
{
	public $prefix = 'wp_';
	public $queries = array();
	public $financial_column_exists = false;

	public function query($query)
	{
		$this->queries[] = $query;
		if (strpos($query, 'ADD COLUMN `financial_residual_value`') !== false) {
			$this->financial_column_exists = true;
		}
		return 1;
	}

	public function prepare($query, ...$args)
	{
		return $query;
	}

	public function get_var($query)
	{
		return strpos($query, 'INFORMATION_SCHEMA.COLUMNS') !== false && $this->financial_column_exists ? 1 : 0;
	}
}

$npcink_schema_options = array(
	'client_tokens' => array(),
	'public_query_enabled' => true,
	'public_query_page_slug' => 'lookup',
	'public_query_access_code_hash' => 'hash',
);

function get_option($name)
{
	global $npcink_schema_options;
	return $name === 'npcink_device_inventory_v3_options' ? $npcink_schema_options : false;
}

function update_option($name, $value)
{
	global $npcink_schema_options;
	if ($name === 'npcink_device_inventory_v3_options') {
		$npcink_schema_options = $value;
	}
	return true;
}

require_once __DIR__ . '/../includes/class-npcink-device-inventory-activator.php';

function npcink_schema_assert($condition, $message)
{
	if (!$condition) {
		fwrite(STDERR, "Schema migration fixture failed: {$message}\n");
		exit(1);
	}
}

$all = Npcink_Device_Inventory_Activator::SCHEMA_REVISIONS;
npcink_schema_assert(
	Npcink_Device_Inventory_Activator::pending_schema_revisions(null) === $all,
	'a fresh install must run every migration in order'
);
npcink_schema_assert(
	Npcink_Device_Inventory_Activator::pending_schema_revisions('20260706_latest_observed') === array('20260715_atomic_identity', '20260715_scope_reset', '20260806_financial_values', '20260807_computer_device_type_default', '20260807_retired_values_zero'),
	'an existing schema must run only newer migrations'
);
npcink_schema_assert(
	Npcink_Device_Inventory_Activator::pending_schema_revisions('20260715_atomic_identity') === array('20260715_scope_reset', '20260806_financial_values', '20260807_computer_device_type_default', '20260807_retired_values_zero'),
	'the pre-GA scope reset must run after atomic identity migration'
);
npcink_schema_assert(
	Npcink_Device_Inventory_Activator::pending_schema_revisions('20260715_scope_reset') === array('20260806_financial_values', '20260807_computer_device_type_default', '20260807_retired_values_zero'),
	'the financial value migration must run after the scope reset'
);
npcink_schema_assert(
	Npcink_Device_Inventory_Activator::pending_schema_revisions(Npcink_Device_Inventory_Activator::SCHEMA_REVISION) === array(),
	'the current schema must not rerun migrations'
);
npcink_schema_assert(
	Npcink_Device_Inventory_Activator::pending_schema_revisions('unknown_revision') === $all,
	'an unknown development revision must be reset through the complete migration chain'
);

$wpdb = new Npcink_Schema_Migration_Fake_Wpdb();
$migration = new ReflectionMethod(Npcink_Device_Inventory_Activator::class, 'run_schema_migration');
$migration->setAccessible(true);
npcink_schema_assert($migration->invoke(null, '20260715_scope_reset') === true, 'scope reset migration must succeed');
npcink_schema_assert(count($wpdb->queries) === 3, 'scope reset must normalize assets and clean identities and obsolete events');
npcink_schema_assert(strpos($wpdb->queries[0], "asset_type IN ('pc', 'computer')") !== false, 'pc and computer values must normalize to computer');
npcink_schema_assert(strpos($wpdb->queries[0], "ELSE 'custom'") !== false, 'other asset types must normalize to custom');
npcink_schema_assert(strpos($wpdb->queries[1], "'system_uuid_v2', 'baseboard_serial_v2', 'pci_permanent_mac_v2'") !== false, 'hardware identity v2 types must survive the scope reset');
npcink_schema_assert(strpos($wpdb->queries[1], "'device_uuid_v1', 'fallback_device_v1'") !== false, 'v1 identities must remain available for the one-time upgrade lookup');
npcink_schema_assert(!isset($npcink_schema_options['public_query_enabled']), 'scope reset must remove obsolete public-query options');

$wpdb = new Npcink_Schema_Migration_Fake_Wpdb();
npcink_schema_assert($migration->invoke(null, '20260806_financial_values') === true, 'financial value migration must succeed');
npcink_schema_assert(count($wpdb->queries) === 1, 'financial value migration must add exactly one column when missing');
npcink_schema_assert(strpos($wpdb->queries[0], 'financial_residual_value') !== false, 'financial value migration must add the accounting residual column');
npcink_schema_assert($migration->invoke(null, '20260806_financial_values') === true, 'financial value migration must be idempotent');
npcink_schema_assert(count($wpdb->queries) === 1, 'idempotent financial value migration must not alter the table again');

$wpdb = new Npcink_Schema_Migration_Fake_Wpdb();
npcink_schema_assert($migration->invoke(null, '20260807_computer_device_type_default') === true, 'computer device type migration must succeed');
npcink_schema_assert(count($wpdb->queries) === 1, 'computer device type migration must run one bounded update');
npcink_schema_assert(strpos($wpdb->queries[0], "asset_type = 'computer'") !== false, 'device type migration must only update computer assets');
npcink_schema_assert(strpos($wpdb->queries[0], "category IN ('computer', '台式机')") !== false, 'legacy computer categories must normalize to the new default');
npcink_schema_assert(strpos($wpdb->queries[0], "SET category = '台式电脑'") !== false, 'computer assets must use the new default type');

$wpdb = new Npcink_Schema_Migration_Fake_Wpdb();
npcink_schema_assert($migration->invoke(null, Npcink_Device_Inventory_Activator::SCHEMA_REVISION) === true, 'retired value migration must succeed');
npcink_schema_assert(count($wpdb->queries) === 1, 'retired value migration must run one bounded update');
npcink_schema_assert(strpos($wpdb->queries[0], "WHERE status = 'retired'") !== false, 'retired value migration must only update retired assets');
npcink_schema_assert(strpos($wpdb->queries[0], 'SET residual_value = 0.00, financial_residual_value = 0.00') !== false, 'retired value migration must zero both current value fields');

echo "Schema migration fixture checks passed.\n";
