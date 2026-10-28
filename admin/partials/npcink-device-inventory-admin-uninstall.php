<?php

if (!defined('ABSPATH')) {
	exit;
}

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching,WordPress.DB.DirectDatabaseQuery.SchemaChange -- Opt-in cleanup removes only plugin-owned tables and raw SQL security counters.

if (!class_exists('Npcink_Device_Inventory_Admin_Uninstall')) {
	class Npcink_Device_Inventory_Admin_Uninstall
	{
		public static function run()
		{
			require_once plugin_dir_path(dirname(dirname(__FILE__))) . 'includes/v3/class-npcink-device-inventory-v3-tables.php';

			$options = Npcink_Device_Inventory_V3_Tables::options();
			if (empty($options['delete_data_on_uninstall'])) {
				return;
			}

			self::delete_sql(
				array(
					Npcink_Device_Inventory_V3_Tables::ASSETS,
					Npcink_Device_Inventory_V3_Tables::IDENTITIES,
					Npcink_Device_Inventory_V3_Tables::OBSERVATIONS,
					Npcink_Device_Inventory_V3_Tables::EVENTS,
				)
			);
			delete_option(Npcink_Device_Inventory_V3_Tables::OPTION);
			delete_option('npcink_device_inventory_data_model_version');
			delete_option('npcink_device_inventory_plugin_version');
			delete_option('npcink_device_inventory_schema_revision');
			// These short-lived rows are written/read directly by the auth service,
			// never through the options cache. Escape underscores in LIKE prefixes.
			global $wpdb;
			$wpdb->query($wpdb->prepare(
				'DELETE FROM %i WHERE option_name LIKE %s OR option_name LIKE %s',
				$wpdb->options,
				$wpdb->esc_like('npcink_v3_upload_nonce_') . '%',
				$wpdb->esc_like('npcink_v3_upload_rate_') . '%'
			));
		}

		public static function delete_sql($table_names = array())
		{
			global $wpdb;
			$allowed_table_names = array(
				Npcink_Device_Inventory_V3_Tables::ASSETS,
				Npcink_Device_Inventory_V3_Tables::IDENTITIES,
				Npcink_Device_Inventory_V3_Tables::OBSERVATIONS,
				Npcink_Device_Inventory_V3_Tables::EVENTS,
			);

			foreach ($table_names as $name) {
				if (!in_array($name, $allowed_table_names, true) || !preg_match('/^[A-Za-z0-9_]+$/', $name)) {
					return false;
				}

				$table_name = $wpdb->prefix . $name;
				$exists = $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like($table_name)));
				if ($exists === $table_name) {
					$wpdb->query($wpdb->prepare('DROP TABLE IF EXISTS %i', $table_name));
				}
			}

			return true;
		}
	}
}
