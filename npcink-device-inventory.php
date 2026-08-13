<?php

/**
 * The plugin bootstrap file
 *
 * This file is read by WordPress to generate the plugin information in the plugin
 * admin area. This file also includes all of the dependencies used by the plugin,
 * registers the activation and deactivation functions, and defines a function
 * that starts the plugin.
 *
 * @link              https://www.npc.ink
 * @since             2.0.0
 * @package    Npcink_Device_Inventory
 *
 * @wordpress-plugin
 * Plugin Name:       Npcink Device Inventory
 * Plugin URI:        https://www.npc.ink/277900.html
 * Description:       设备资产管理插件，提供设备录入、客户端上报、后台台账和变更记录。
 * Version:           3.2.1
 * Requires at least: 6.5
 * Tested up to:      7.0
 * Requires PHP:      7.4
 * Author:            Npcink
 * Author URI:        https://www.npc.ink
 * License:           GPL-2.0+
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.txt
 * Text Domain:       npcink-device-inventory
 * Domain Path:       /languages
 */

// If this file is called directly, abort.
if (!defined('WPINC')) {
	die;
}

/**
 * Currently plugin version.
 * Start at version 1.0.0 and use SemVer - https://semver.org
 * Rename this for your plugin and update it as you release new versions.
 */
define('NPCINK_DEVICE_INVENTORY_VERSION', '3.2.1');

/**
 * The code that runs during plugin activation.
 * This action is documented in includes/class-npcink-device-inventory-activator.php
 */
function npcink_device_inventory_activate()
{
	require_once plugin_dir_path(__FILE__) . 'includes/class-npcink-device-inventory-activator.php';
	Npcink_Device_Inventory_Activator::run();
}

/**
 * The code that runs during plugin deactivation.
 * This action is documented in includes/class-npcink-device-inventory-deactivator.php
 */
function npcink_device_inventory_deactivate()
{
	require_once plugin_dir_path(__FILE__) . 'includes/class-npcink-device-inventory-deactivator.php';
	Npcink_Device_Inventory_Deactivator::deactivate();
}

register_activation_hook(__FILE__, 'npcink_device_inventory_activate');
register_deactivation_hook(__FILE__, 'npcink_device_inventory_deactivate');

/**
 * Run schema upgrades as part of the WordPress plugin update transaction,
 * rather than waiting for an administrator to open the dashboard.
 */
function npcink_device_inventory_upgrade_after_update($upgrader, $hook_extra)
{
	if (
		!is_array($hook_extra)
		|| empty($hook_extra['action'])
		|| $hook_extra['action'] !== 'update'
		|| empty($hook_extra['type'])
		|| $hook_extra['type'] !== 'plugin'
		|| empty($hook_extra['plugins'])
		|| !in_array(plugin_basename(__FILE__), (array) $hook_extra['plugins'], true)
	) {
		return;
	}

	if (function_exists('is_multisite') && is_multisite() && function_exists('get_sites') && function_exists('switch_to_blog') && function_exists('restore_current_blog')) {
		$site_ids = get_sites(array('fields' => 'ids', 'number' => 0));
		foreach ((array) $site_ids as $site_id) {
			switch_to_blog((int) $site_id);
			try {
				npcink_device_inventory_activate();
			} finally {
				restore_current_blog();
			}
		}
		return;
	}

	npcink_device_inventory_activate();
}

add_action('upgrader_process_complete', 'npcink_device_inventory_upgrade_after_update', 10, 2);

/**
 * The core plugin class that is used to define internationalization,
 * admin-specific hooks, and public-facing site hooks.
 */
require plugin_dir_path(__FILE__) . 'includes/class-npcink-device-inventory.php';

/**
 * Begins execution of the plugin.
 *
 * Since everything within the plugin is registered via hooks,
 * then kicking off the plugin from this point in the file does
 * not affect the page life cycle.
 *
 * @since    1.0.0
 */
function npcink_device_inventory_run()
{

	$plugin = new Npcink_Device_Inventory();
	$plugin->run();
}
npcink_device_inventory_run();


//设置按钮
add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
	$links[] = '<a href="' . esc_url(get_admin_url(null, 'plugins.php?page=npcink_device_inventory_settings')) . '">' . esc_html__('设置', 'npcink-device-inventory') . '</a>';
	return $links;
});

/**开发用 */
//require plugin_dir_path(__FILE__) . 'index.php';
