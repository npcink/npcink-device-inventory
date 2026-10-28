<?php

if (!defined('ABSPATH')) {
	exit;
}

class Npcink_Device_Inventory_Event_Service
{
	private $events;

	public function __construct(Npcink_Device_Inventory_Event_Repository $events)
	{
		$this->events = $events;
	}

	public function record($asset_id, $source, $type, $message, $payload = array())
	{
		return $this->events->create(
			$asset_id,
			array(
				'event_source' => $source,
				'event_type' => $type,
				'message' => $message,
				'actor_user_id' => get_current_user_id(),
				'actor_name' => $this->actor_name(),
				'payload' => $payload,
			)
		);
	}

	public function invalidate_cache()
	{
		$this->events->invalidate_cache();
	}

	private function actor_name()
	{
		$user = wp_get_current_user();
		if ($user && $user->exists()) {
			return $user->display_name;
		}
		return 'system';
	}
}
