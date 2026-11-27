<?php

// Run with WP-CLI against the isolated WordPress integration site only.
if (!defined('WP_CLI') || !WP_CLI || wp_get_environment_type() !== 'local') {
    throw new RuntimeException('An isolated local WordPress CLI is required.');
}

$domain = 'npcink-device-inventory';
$mode   = $args[0] ?? '';

if ($mode === 'install-fixtures') {
    require_once ABSPATH . WPINC . '/pomo/mo.php';
    $directory = WP_LANG_DIR . '/plugins';
    if (!wp_mkdir_p($directory)) {
        throw new RuntimeException('Could not create the plugin language directory.');
    }
    foreach (array('fr_FR' => array('Inventaire de test', 'Réglages de test'), 'zh_CN' => array('测试台账', '测试配置')) as $locale => $labels) {
        $file = "$directory/$domain-$locale.mo";
        if (file_exists($file)) {
            throw new RuntimeException('Refusing to overwrite an existing language pack: ' . $locale);
        }
        $catalog = new MO();
        foreach (array_combine(array('Device Inventory', 'Settings'), $labels) as $source => $translation) {
            $catalog->add_entry(new Translation_Entry(array('singular' => $source, 'translations' => array($translation))));
        }
        if (!$catalog->export_to_file($file)) {
            throw new RuntimeException('Could not write the fixture language pack: ' . $locale);
        }
    }
    return;
}

$expected = array(
    'en_US' => array('Device Inventory', 'Settings'),
    'fr_FR' => array('Inventaire de test', 'Réglages de test'),
    'zh_CN' => array('测试台账', '测试配置'),
    'zh_TW' => array('设备资产管理', '设置'), // Existing Chinese fallback without an installed pack.
);
if (!isset($expected[$mode])) {
    throw new RuntimeException('Supply install-fixtures or a test locale.');
}

// Each locale runs in a fresh WP request, allowing core to discover and load the real .mo file.
add_filter('pre_determine_locale', static function () use ($mode) {
    return $mode;
});

require_once ABSPATH . 'wp-admin/includes/plugin.php';
Npcink_Device_Inventory_Admin_Menu::register_admin_menu();
$title = null;
foreach ($GLOBALS['submenu']['plugins.php'] ?? array() as $item) {
    if ($item[2] === 'npcink_device_inventory_settings') {
        $title = array($item[0], $item[3]);
        break;
    }
}
$links = apply_filters('plugin_action_links_npcink-device-inventory/npcink-device-inventory.php', array());
if ($title !== array($expected[$mode][0], $expected[$mode][0]) || count($links) !== 1 || wp_strip_all_tags(reset($links)) !== $expected[$mode][1]) {
    throw new RuntimeException(sprintf('%s labels did not match: %s', $mode, wp_json_encode(array($title, $links), JSON_UNESCAPED_UNICODE)));
}

echo 'WordPress admin translations verified: ' . $mode . PHP_EOL;
