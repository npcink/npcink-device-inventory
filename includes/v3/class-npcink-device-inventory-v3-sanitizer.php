<?php

if (!defined('ABSPATH')) {
	exit;
}

class Npcink_Device_Inventory_V3_Sanitizer
{
	const MAX_DEPTH = 24;
	const MAX_STRING_LENGTH = 10000;
	const MAX_KEY_LENGTH = 128;

	/** JSON facts are validated at the input boundary and escaped at output, never text-sanitized. */
	public static function json_encode($value)
	{
		return wp_json_encode($value);
	}
}
