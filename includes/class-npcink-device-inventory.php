<?php

/**
 * The file that defines the core plugin class
 *
 * A class definition that includes attributes and functions used by the admin area.
 *
 * @link       https://www.npc.ink
 * @since      1.0.0
 *
 * @package    Npcink_Device_Inventory
 * @subpackage Npcink_Device_Inventory/includes
 */

/**
 * The core plugin class.
 *
 * This is used to define internationalization and admin-specific hooks.
 *
 * Also maintains the unique identifier of this plugin as well as the current
 * version of the plugin.
 *
 * @since      1.0.0
 * @package    Npcink_Device_Inventory
 * @subpackage Npcink_Device_Inventory/includes
 * @author     Npcink <1355471563@qq.com>
 */
class Npcink_Device_Inventory
{

	/**
	 * The loader that's responsible for maintaining and registering all hooks that power
	 * the plugin.
	 *
	 * @since    1.0.0
	 * @access   protected
	 * @var      Npcink_Device_Inventory_Loader    $loader    Maintains and registers all hooks for the plugin.
	 */
	protected $loader;

	/**
	 * The unique identifier of this plugin.
	 *
	 * @since    1.0.0
	 * @access   protected
	 * @var      string    $plugin_name    The string used to uniquely identify this plugin.
	 */
	protected $plugin_name;

	/**
	 * The current version of the plugin.
	 *
	 * @since    1.0.0
	 * @access   protected
	 * @var      string    $version    The current version of the plugin.
	 */
	protected $version;

	/**
	 * Define the core functionality of the plugin.
	 *
	 * Set the plugin name and the plugin version that can be used throughout the plugin.
	 * Load the dependencies, define the locale, and set the hooks for the admin area and
	 * the admin area.
	 *
	 * @since    1.0.0
	 */
	public function __construct()
	{
		if (defined('NPCINK_DEVICE_INVENTORY_VERSION')) {
			$this->version = NPCINK_DEVICE_INVENTORY_VERSION;
		} else {
			$this->version = '1.0.0';
		}
		$this->plugin_name = 'npcink-device-inventory';

		$this->load_dependencies();
		$this->set_locale();
		$this->define_admin_hooks();
	}

	/**
	 * Load the required dependencies for this plugin.
	 *
	 * Include the following files that make up the plugin:
	 *
	 * - Npcink_Device_Inventory_Loader. Orchestrates the hooks of the plugin.
	 * - Npcink_Device_Inventory_I18n. Defines internationalization functionality.
	 * - Npcink_Device_Inventory_Admin. Defines all hooks for the admin area.
	 *
	 * Create an instance of the loader which will be used to register the hooks
	 * with WordPress.
	 *
	 * @since    1.0.0
	 * @access   private
	 */
	private function load_dependencies()
	{

		/**
		 * The class responsible for orchestrating the actions and filters of the
		 * core plugin.
		 */
		require_once plugin_dir_path(dirname(__FILE__)) . 'includes/class-npcink-device-inventory-loader.php';

		/**
		 * The class responsible for defining internationalization functionality
		 * of the plugin.
		 */
		require_once plugin_dir_path(dirname(__FILE__)) . 'includes/class-npcink-device-inventory-i18n.php';

		/**
		 * The class responsible for defining all actions that occur in the admin area.
		 */
		require_once plugin_dir_path(dirname(__FILE__)) . 'admin/class-npcink-device-inventory-admin.php';

		$this->loader = new Npcink_Device_Inventory_Loader();
	}

	/**
	 * Define the locale for this plugin for internationalization.
	 *
	 * Uses the Npcink_Device_Inventory_I18n class in order to set the domain and to register the hook
	 * with WordPress.
	 *
	 * @since    1.0.0
	 * @access   private
	 */
	private function set_locale()
	{
		// WordPress.org loads plugin translations automatically for this text domain.
	}

	/**
	 * Register all of the hooks related to the admin area functionality
	 * of the plugin.
	 *
	 * @since    1.0.0
	 * @access   private
	 */
	private function define_admin_hooks()
	{

		$plugin_admin = new Npcink_Device_Inventory_Admin($this->get_plugin_name(), $this->get_version());

		$this->loader->add_action('admin_init', $this, 'maybe_upgrade');
		$this->loader->add_action('init', $this, 'ensure_observation_cleanup_schedule');
		$this->loader->add_action('npcink_device_inventory_cleanup_observations', $this, 'cleanup_observations');
	}

	public function ensure_observation_cleanup_schedule()
	{
		if (!wp_next_scheduled('npcink_device_inventory_cleanup_observations')) {
			wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', 'npcink_device_inventory_cleanup_observations');
		}
	}

	public function cleanup_observations()
	{
		require_once plugin_dir_path(dirname(__FILE__)) . 'includes/v3/class-npcink-device-inventory-v3-tables.php';
		$options = Npcink_Device_Inventory_V3_Tables::options();
		$days = intval($options['observation_retention_days']);
		if ($days <= 0) {
			return;
		}
		require_once plugin_dir_path(dirname(__FILE__)) . 'includes/v3/class-npcink-device-inventory-v3-sanitizer.php';
		require_once plugin_dir_path(dirname(__FILE__)) . 'includes/v3/repositories/class-npcink-device-inventory-observation-repository.php';
		$repository = new Npcink_Device_Inventory_Observation_Repository();
		$repository->delete_older_than(gmdate('Y-m-d H:i:s', time() - ($days * DAY_IN_SECONDS)));
	}



	/**
	 * Run the loader to execute all of the hooks with WordPress.
	 *
	 * @since    1.0.0
	 */
	public function run()
	{
		$this->loader->run();
	}

	/**
	 * 插件升级时执行数据库与触发器校验
	 */
	public function maybe_upgrade()
	{
		if (!current_user_can('manage_options')) {
			return;
		}

		$schema_revision = get_option('npcink_device_inventory_schema_revision');
		$installed_version = get_option('npcink_device_inventory_plugin_version');
		require_once plugin_dir_path(dirname(__FILE__)) . 'includes/class-npcink-device-inventory-activator.php';
		if ($schema_revision === Npcink_Device_Inventory_Activator::SCHEMA_REVISION) {
			if ($installed_version !== $this->version) {
				update_option('npcink_device_inventory_plugin_version', $this->version);
			}
			return;
		}

		Npcink_Device_Inventory_Activator::upgrade_schema($schema_revision, $this->version);
	}

	/**
	 * The name of the plugin used to uniquely identify it within the context of
	 * WordPress and to define internationalization functionality.
	 *
	 * @since     1.0.0
	 * @return    string    The name of the plugin.
	 */
	public function get_plugin_name()
	{
		return $this->plugin_name;
	}

	/**
	 * The reference to the class that orchestrates the hooks with the plugin.
	 *
	 * @since     1.0.0
	 * @return    Npcink_Device_Inventory_Loader    Orchestrates the hooks of the plugin.
	 */
	public function get_loader()
	{
		return $this->loader;
	}

	/**
	 * Retrieve the version number of the plugin.
	 *
	 * @since     1.0.0
	 * @return    string    The version number of the plugin.
	 */
	public function get_version()
	{
		return $this->version;
	}
}
