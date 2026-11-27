<?php

if (!defined('ABSPATH')) {
	exit;
}

if (!class_exists('Npcink_Device_Inventory_Admin_Interface')) {
	class Npcink_Device_Inventory_Admin_Interface
	{
		public static $table_assets_name = 'npcink_assets';
		public static $table_asset_identities_name = 'npcink_asset_identities';
		public static $table_asset_observations_name = 'npcink_asset_observations';
		public static $table_asset_events_name = 'npcink_asset_events';

		public static function run()
		{
			require_once plugin_dir_path(dirname(dirname(__FILE__))) . 'includes/v3/class-npcink-device-inventory-v3-rest.php';
			Npcink_Device_Inventory_V3_Rest::run();
		}
	}
}
