<?php

if (!defined('ABSPATH')) {
	exit;
}

class Npcink_Device_Inventory_Assets_Controller
{
	const ASSET_TYPES = array('computer', 'custom');
	const IDENTITY_TYPES = array('system_uuid_v2', 'baseboard_serial_v2', 'pci_permanent_mac_v2');
	const ASSET_STATUSES = array('active', 'inactive', 'maintenance', 'retired', 'deleted');
	const MAX_BATCH_SIZE = 100;

	private $assets;
	private $identities;
	private $observations;
	private $events;
	private $event_service;

	public function __construct(
		Npcink_Device_Inventory_Asset_Repository $assets,
		Npcink_Device_Inventory_Identity_Repository $identities,
		Npcink_Device_Inventory_Observation_Repository $observations,
		Npcink_Device_Inventory_Event_Repository $events,
		Npcink_Device_Inventory_Event_Service $event_service
	) {
		$this->assets = $assets;
		$this->identities = $identities;
		$this->observations = $observations;
		$this->events = $events;
		$this->event_service = $event_service;
	}

	public function register_routes()
	{
		register_rest_route(
			'npcink-device-inventory/v1',
			'/assets',
			array(
				array(
					'methods' => WP_REST_Server::READABLE,
					'callback' => array($this, 'get_items'),
					'permission_callback' => array($this, 'admin_permissions_check'),
				),
				array(
					'methods' => WP_REST_Server::CREATABLE,
					'callback' => array($this, 'create_item'),
					'permission_callback' => array($this, 'admin_permissions_check'),
				),
			)
		);

		register_rest_route(
			'npcink-device-inventory/v1',
			'/assets/batch',
			array(
				'methods' => WP_REST_Server::CREATABLE,
				'callback' => array($this, 'batch_items'),
				'permission_callback' => array($this, 'admin_permissions_check'),
			)
		);

		register_rest_route(
			'npcink-device-inventory/v1',
			'/assets/(?P<uuid>[A-Za-z0-9_-]+)',
			array(
				array(
					'methods' => WP_REST_Server::READABLE,
					'callback' => array($this, 'get_item'),
					'permission_callback' => array($this, 'admin_permissions_check'),
				),
				array(
					'methods' => WP_REST_Server::EDITABLE,
					'callback' => array($this, 'update_item'),
					'permission_callback' => array($this, 'admin_permissions_check'),
				),
				array(
					'methods' => WP_REST_Server::DELETABLE,
					'callback' => array($this, 'delete_item'),
					'permission_callback' => array($this, 'admin_permissions_check'),
				),
			)
		);

		register_rest_route(
			'npcink-device-inventory/v1',
			'/assets/(?P<uuid>[A-Za-z0-9_-]+)/identities',
			array(
				array(
					'methods' => WP_REST_Server::READABLE,
					'callback' => array($this, 'get_identities'),
					'permission_callback' => array($this, 'admin_permissions_check'),
				),
				array(
					'methods' => WP_REST_Server::CREATABLE,
					'callback' => array($this, 'create_identity'),
					'permission_callback' => array($this, 'admin_permissions_check'),
				),
			)
		);

		register_rest_route(
			'npcink-device-inventory/v1',
			'/assets/(?P<uuid>[A-Za-z0-9_-]+)/observations',
			array(
				'methods' => WP_REST_Server::READABLE,
				'callback' => array($this, 'get_observations'),
				'permission_callback' => array($this, 'admin_permissions_check'),
			)
		);

		register_rest_route(
			'npcink-device-inventory/v1',
			'/assets/(?P<uuid>[A-Za-z0-9_-]+)/events',
			array(
				array(
					'methods' => WP_REST_Server::READABLE,
					'callback' => array($this, 'get_events'),
					'permission_callback' => array($this, 'admin_permissions_check'),
				),
				array(
					'methods' => WP_REST_Server::CREATABLE,
					'callback' => array($this, 'create_event'),
					'permission_callback' => array($this, 'admin_permissions_check'),
				),
			)
		);

		register_rest_route(
			'npcink-device-inventory/v1',
			'/events',
			array(
				'methods' => WP_REST_Server::READABLE,
				'callback' => array($this, 'get_all_events'),
				'permission_callback' => array($this, 'admin_permissions_check'),
			)
		);

		register_rest_route(
			'npcink-device-inventory/v1',
			'/observations',
			array(
				'methods' => WP_REST_Server::READABLE,
				'callback' => array($this, 'get_all_observations'),
				'permission_callback' => array($this, 'admin_permissions_check'),
			)
		);
	}

	public function admin_permissions_check()
	{
		if (!current_user_can('manage_options')) {
			return Npcink_Device_Inventory_V3_Response::error('forbidden', 'Administrator permission is required.', 403);
		}
		return true;
	}

	public function get_items($request)
	{
		$result = $this->assets->list_assets(
			array(
				'page' => $request->get_param('page') ?: 1,
				'pageSize' => $request->get_param('pageSize') ?: 20,
				'search' => $request->get_param('search'),
				'asset_type' => $request->get_param('assetType'),
				'asset_scope' => $request->get_param('assetScope'),
				'status' => $request->get_param('status'),
				'department' => $request->get_param('department'),
				'category' => $request->get_param('category'),
				'purchase_platform' => $request->get_param('purchasePlatform'),
				'sort_by' => $request->get_param('sortBy'),
				'include_deleted' => $request->get_param('includeDeleted'),
			)
		);
		$items = array_map(array($this, 'format_asset'), $result['items']);
		return rest_ensure_response(
			Npcink_Device_Inventory_V3_Response::paginated($items, $result['page'], $result['pageSize'], $result['total'])
		);
	}

	public function create_item($request)
	{
		$params = $request->get_json_params();
		if (!is_array($params)) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_json', 'Request body must be valid JSON.', 400);
		}
		$input = $this->validate_asset_input($params, true);
		if (is_wp_error($input)) {
			return $input;
		}
		if (!$this->begin_transaction()) {
			return Npcink_Device_Inventory_V3_Response::error('transaction_start_failed', 'Failed to start asset transaction.', 500);
		}
		$asset = $this->assets->create($input);
		if (!$asset) {
			return $this->rollback_error('asset_create_failed', 'Failed to create asset.');
		}
		if (!$this->event_service->record(intval($asset['id']), 'manual', 'created', 'Asset created in admin.')) {
			return $this->rollback_error('event_create_failed', 'Failed to record asset creation.');
		}
		if (!$this->commit_transaction()) {
			return $this->rollback_error('transaction_commit_failed', 'Failed to commit asset transaction.');
		}
		return rest_ensure_response(array('data' => $this->format_asset($asset)));
	}

	public function get_item($request)
	{
		$asset = $this->asset_from_request($request);
		if (is_wp_error($asset)) {
			return $asset;
		}
		return rest_ensure_response(array('data' => $this->format_asset($asset)));
	}

	public function update_item($request)
	{
		$asset = $this->asset_from_request($request);
		if (is_wp_error($asset)) {
			return $asset;
		}
		$params = $request->get_json_params();
		if (!is_array($params)) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_json', 'Request body must be valid JSON.', 400);
		}

		$update_data = $this->validate_asset_input($params, false);
		if (is_wp_error($update_data)) {
			return $update_data;
		}
		if (empty($update_data)) {
			return Npcink_Device_Inventory_V3_Response::error('empty_asset_update', 'At least one asset field is required.', 422);
		}
		if (!$this->begin_transaction()) {
			return Npcink_Device_Inventory_V3_Response::error('transaction_start_failed', 'Failed to start asset transaction.', 500);
		}
		$updated = $this->assets->update($asset['uuid'], $update_data);
		if (!$updated) {
			return $this->rollback_error('asset_update_failed', 'Failed to update asset.');
		}
		if (!$this->event_service->record(intval($asset['id']), 'manual', 'updated', 'Asset updated in admin.')) {
			return $this->rollback_error('event_create_failed', 'Failed to record asset update.');
		}
		if (!$this->commit_transaction()) {
			return $this->rollback_error('transaction_commit_failed', 'Failed to commit asset transaction.');
		}
		return rest_ensure_response(array('data' => $this->format_asset($updated)));
	}

	public function delete_item($request)
	{
		$asset = $this->asset_from_request($request);
		if (is_wp_error($asset)) {
			return $asset;
		}
		if (!$this->begin_transaction()) {
			return Npcink_Device_Inventory_V3_Response::error('transaction_start_failed', 'Failed to start asset transaction.', 500);
		}
		$updated = $this->assets->update($asset['uuid'], array('status' => 'deleted'));
		if (!$updated) {
			return $this->rollback_error('asset_update_failed', 'Failed to archive asset.');
		}
		if (!$this->event_service->record(intval($asset['id']), 'manual', 'deleted', 'Asset marked as deleted.')) {
			return $this->rollback_error('event_create_failed', 'Failed to record asset archive.');
		}
		if (!$this->commit_transaction()) {
			return $this->rollback_error('transaction_commit_failed', 'Failed to commit asset transaction.');
		}
		return rest_ensure_response(array('data' => $this->format_asset($updated)));
	}

	public function batch_items($request)
	{
		$params = $request->get_json_params();
		if (!is_array($params)) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_json', 'Request body must be valid JSON.', 400);
		}
		$operation = isset($params['operation']) ? sanitize_key((string) $params['operation']) : '';
		if (!in_array($operation, array('archive', 'update'), true)) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_batch_operation', 'Batch operation must be archive or update.', 422);
		}
		$uuids = $this->validate_batch_uuids(isset($params['uuids']) ? $params['uuids'] : null);
		if (is_wp_error($uuids)) {
			return $uuids;
		}
		$changes = $operation === 'archive'
			? array('status' => 'deleted')
			: $this->validate_asset_input(isset($params['changes']) && is_array($params['changes']) ? $params['changes'] : array(), false);
		if (is_wp_error($changes)) {
			return $changes;
		}
		if (empty($changes)) {
			return Npcink_Device_Inventory_V3_Response::error('empty_asset_update', 'At least one asset field is required.', 422);
		}
		$context = isset($params['context']) && is_array($params['context']) ? $params['context'] : array();
		$context_source = isset($context['source']) ? sanitize_key((string) $context['source']) : 'asset_batch';
		$context_message = isset($context['message']) ? sanitize_textarea_field((string) $context['message']) : '';
		if ($this->text_length($context_source) > 64 || $this->text_length($context_message) > 500) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_batch_context', 'Batch context is too long.', 422);
		}
		if (!$this->begin_transaction()) {
			return Npcink_Device_Inventory_V3_Response::error('transaction_start_failed', 'Failed to start batch transaction.', 500);
		}

		$updated_items = array();
		foreach ($uuids as $uuid) {
			$asset = $this->assets->find_by_uuid($uuid);
			if (!$asset) {
				return $this->rollback_error('asset_not_found', 'Batch asset not found: ' . $uuid, 404);
			}
			$updated = $this->assets->update($uuid, $changes);
			if (!$updated) {
				return $this->rollback_error('asset_update_failed', 'Failed to update batch asset: ' . $uuid);
			}
			$event_type = $operation === 'archive' ? 'bulk_archived' : 'bulk_updated';
			$message = $context_message !== ''
				? $context_message
				: ($operation === 'archive' ? 'Asset archived in admin batch.' : 'Asset updated in admin batch.');
			if (!$this->event_service->record(
				intval($asset['id']),
				'manual',
				$event_type,
				$message,
				array(
					'source' => $context_source,
					'changedFields' => $this->batch_changed_fields($asset, $changes),
					'batchSize' => count($uuids),
				)
			)) {
				return $this->rollback_error('event_create_failed', 'Failed to record batch asset event.');
			}
			$updated_items[] = $this->format_asset($updated);
		}

		if (!$this->commit_transaction()) {
			return $this->rollback_error('transaction_commit_failed', 'Failed to commit batch transaction.');
		}
		return rest_ensure_response(
			array(
				'data' => array(
					'operation' => $operation,
					'updated' => count($updated_items),
					'items' => $updated_items,
				),
			)
		);
	}

	public function get_identities($request)
	{
		$asset = $this->asset_from_request($request);
		if (is_wp_error($asset)) {
			return $asset;
		}
		$items = $this->identities->list_for_asset(intval($asset['id']));
		return rest_ensure_response(array('data' => array_map(array($this, 'format_identity'), $items)));
	}

	public function create_identity($request)
	{
		$asset = $this->asset_from_request($request);
		if (is_wp_error($asset)) {
			return $asset;
		}
		$params = $request->get_json_params();
		if (!is_array($params) || !isset($params['type'], $params['value']) || !is_scalar($params['type']) || !is_scalar($params['value'])) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_identity', 'Identity type and value are required.', 422);
		}
		$type = sanitize_key((string) $params['type']);
		$value = sanitize_text_field((string) $params['value']);
		$confidence = isset($params['confidence']) && is_numeric($params['confidence']) ? floatval($params['confidence']) : 100;
		if (!in_array($type, self::IDENTITY_TYPES, true) || $value === '' || $this->text_length($value) > 191 || $confidence < 0 || $confidence > 100) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_identity', 'Identity fields are invalid.', 422);
		}
		if (!$this->begin_transaction()) {
			return Npcink_Device_Inventory_V3_Response::error('transaction_start_failed', 'Failed to start identity transaction.', 500);
		}
		$claim = $this->identities->claim(
			intval($asset['id']),
			array(
				'type' => $type,
				'value' => $value,
				'confidence' => $confidence,
				'source' => 'manual',
			),
			!empty($params['isPrimary'])
		);
		if ($claim['status'] === Npcink_Device_Inventory_Identity_Repository::CLAIM_CONFLICT) {
			$this->rollback_transaction();
			return Npcink_Device_Inventory_V3_Response::error(
				'identity_conflict',
				'Identity is already owned by another asset.',
				409,
				array('ownerAssetId' => $claim['ownerAssetId'])
			);
		}
		if ($claim['status'] === Npcink_Device_Inventory_Identity_Repository::CLAIM_INVALID) {
			$this->rollback_transaction();
			return Npcink_Device_Inventory_V3_Response::error('invalid_identity', 'Identity type and value are required.', 422);
		}
		if ($claim['status'] === Npcink_Device_Inventory_Identity_Repository::CLAIM_ERROR) {
			$this->rollback_transaction();
			return Npcink_Device_Inventory_V3_Response::error('identity_claim_failed', 'Failed to claim identity.', 500);
		}
		if ($claim['status'] === Npcink_Device_Inventory_Identity_Repository::CLAIM_INSERTED) {
			if (!$this->event_service->record(intval($asset['id']), 'manual', 'identity_added', 'Asset identity added in admin.')) {
				return $this->rollback_error('event_create_failed', 'Failed to record identity claim.');
			}
		}
		if (!$this->commit_transaction()) {
			return $this->rollback_error('transaction_commit_failed', 'Failed to commit identity transaction.');
		}
		$items = $this->identities->list_for_asset(intval($asset['id']));
		return rest_ensure_response(array('data' => array_map(array($this, 'format_identity'), $items)));
	}

	public function get_observations($request)
	{
		$asset = $this->asset_from_request($request);
		if (is_wp_error($asset)) {
			return $asset;
		}
		$result = $this->observations->list_for_asset(intval($asset['id']), $request->get_param('page') ?: 1, $request->get_param('pageSize') ?: 20);
		$items = array_map(array($this, 'format_observation'), $result['items']);
		return rest_ensure_response(
			Npcink_Device_Inventory_V3_Response::paginated($items, $result['page'], $result['pageSize'], $result['total'])
		);
	}

	public function get_events($request)
	{
		$asset = $this->asset_from_request($request);
		if (is_wp_error($asset)) {
			return $asset;
		}
		$result = $this->events->list_for_asset(intval($asset['id']), $request->get_param('page') ?: 1, $request->get_param('pageSize') ?: 20);
		$items = array_map(array($this, 'format_event'), $result['items']);
		return rest_ensure_response(
			Npcink_Device_Inventory_V3_Response::paginated($items, $result['page'], $result['pageSize'], $result['total'])
		);
	}

	public function get_all_events($request)
	{
		$result = $this->events->list_all(
			array(
				'page' => $request->get_param('page') ?: 1,
				'pageSize' => $request->get_param('pageSize') ?: 20,
				'event_mode' => $request->get_param('eventMode'),
				'event_source' => $request->get_param('eventSource'),
				'event_type' => $request->get_param('eventType'),
				'search' => $request->get_param('search'),
			)
		);
		$items = array_map(array($this, 'format_event'), $result['items']);
		return rest_ensure_response(
			Npcink_Device_Inventory_V3_Response::paginated($items, $result['page'], $result['pageSize'], $result['total'])
		);
	}

	public function get_all_observations($request)
	{
		$result = $this->observations->list_all(
			array(
				'page' => $request->get_param('page') ?: 1,
				'pageSize' => $request->get_param('pageSize') ?: 20,
				'source' => $request->get_param('source'),
				'search' => $request->get_param('search'),
			)
		);
		$items = array_map(array($this, 'format_observation'), $result['items']);
		return rest_ensure_response(
			Npcink_Device_Inventory_V3_Response::paginated($items, $result['page'], $result['pageSize'], $result['total'])
		);
	}

	public function create_event($request)
	{
		$asset = $this->asset_from_request($request);
		if (is_wp_error($asset)) {
			return $asset;
		}
		$params = $request->get_json_params();
		if (!is_array($params) || !isset($params['message']) || !is_scalar($params['message']) || trim((string) $params['message']) === '') {
			return Npcink_Device_Inventory_V3_Response::error('invalid_event', 'Event message is required.', 422);
		}
		if (isset($params['eventType']) && !is_scalar($params['eventType'])) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_event_type', 'Event type is invalid.', 422);
		}
		$event_type = isset($params['eventType']) ? sanitize_key($params['eventType']) : 'note';
		if (in_array($event_type, array('issue_handled', 'issue_reopened', 'identity_reconciled'), true)) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_event_type', 'This event workflow is no longer supported.', 422);
		}
		$result = $this->event_service->record(
			intval($asset['id']),
			'manual',
			$event_type,
			sanitize_textarea_field((string) $params['message']),
			isset($params['payload']) && is_array($params['payload']) ? $params['payload'] : array()
		);
		if (!$result) {
			return Npcink_Device_Inventory_V3_Response::error('event_create_failed', 'Failed to create asset event.', 500);
		}
		return rest_ensure_response(array('data' => array('success' => true)));
	}

	private function validate_asset_input($params, $creating)
	{
		$data = array();
		if ($creating) {
			$uuid = isset($params['uuid']) && is_scalar($params['uuid']) ? sanitize_text_field((string) $params['uuid']) : '';
			if ($uuid !== '' && !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $uuid)) {
				return Npcink_Device_Inventory_V3_Response::error('invalid_asset_uuid', 'Asset UUID must be a valid UUID v4.', 422);
			}
			$data['uuid'] = $uuid;
		}

		if ($creating || array_key_exists('assetType', $params)) {
			$asset_type = isset($params['assetType']) && is_scalar($params['assetType']) ? sanitize_key((string) $params['assetType']) : 'custom';
			if (!in_array($asset_type, self::ASSET_TYPES, true)) {
				return Npcink_Device_Inventory_V3_Response::error('invalid_asset_type', 'Asset type is not supported.', 422);
			}
			$data['asset_type'] = $asset_type;
		}

		if ($creating || array_key_exists('status', $params)) {
			$status = isset($params['status']) && is_scalar($params['status']) ? sanitize_key((string) $params['status']) : 'active';
			if (!in_array($status, self::ASSET_STATUSES, true)) {
				return Npcink_Device_Inventory_V3_Response::error('invalid_asset_status', 'Asset status is not supported.', 422);
			}
			$data['status'] = $status;
		}

		$text_fields = array(
			'assetNumber' => array('asset_number', 64),
			'name' => array('name', 191),
			'ownerName' => array('owner_name', 191),
			'department' => array('department', 80),
			'category' => array('category', 191),
		);
		foreach ($text_fields as $input_key => $definition) {
			if (!$creating && !array_key_exists($input_key, $params)) {
				continue;
			}
			$value = isset($params[$input_key]) && is_scalar($params[$input_key]) ? sanitize_text_field((string) $params[$input_key]) : '';
			if ($this->text_length($value) > $definition[1]) {
				return Npcink_Device_Inventory_V3_Response::error('asset_field_too_long', 'Asset field is too long: ' . $input_key, 422);
			}
			if (!$creating && $input_key === 'assetNumber' && $value === '') {
				return Npcink_Device_Inventory_V3_Response::error('invalid_asset_number', 'Asset number cannot be empty.', 422);
			}
			if ($input_key === 'department') {
				$department_check = $this->validate_department($value);
				if (is_wp_error($department_check)) {
					return $department_check;
				}
			}
			$data[$definition[0]] = $value;
		}

		$number_fields = array('purchasePrice' => 'purchase_price', 'residualValue' => 'residual_value');
		foreach ($number_fields as $input_key => $storage_key) {
			if (!$creating && !array_key_exists($input_key, $params)) {
				continue;
			}
			$value = isset($params[$input_key]) ? $params[$input_key] : 0;
			if (!is_numeric($value) || !is_finite(floatval($value)) || floatval($value) < 0 || floatval($value) > 9999999999.99) {
				return Npcink_Device_Inventory_V3_Response::error('invalid_asset_value', 'Asset financial values must be finite non-negative numbers.', 422);
			}
			$data[$storage_key] = floatval($value);
		}

		if ($creating || array_key_exists('metadata', $params)) {
			if (isset($params['metadata']) && !is_array($params['metadata'])) {
				return Npcink_Device_Inventory_V3_Response::error('invalid_asset_metadata', 'Asset metadata must be a JSON object.', 422);
			}
			$data[$creating ? 'metadata' : 'metadata_json'] = isset($params['metadata']) ? $params['metadata'] : array();
		}
		return $data;
	}

	private function validate_batch_uuids($input)
	{
		if (!is_array($input) || empty($input) || count($input) > self::MAX_BATCH_SIZE) {
			return Npcink_Device_Inventory_V3_Response::error('invalid_batch_assets', 'Batch must contain 1 to 100 asset UUIDs.', 422);
		}
		$uuids = array();
		foreach ($input as $value) {
			$uuid = is_scalar($value) ? sanitize_text_field((string) $value) : '';
			if ($uuid === '' || !preg_match('/^[A-Za-z0-9_-]+$/', $uuid)) {
				return Npcink_Device_Inventory_V3_Response::error('invalid_batch_assets', 'Batch contains an invalid asset UUID.', 422);
			}
			$uuids[$uuid] = true;
		}
		return array_keys($uuids);
	}

	private function batch_changed_fields($asset, $changes)
	{
		$fields = array();
		foreach ($changes as $field => $new_value) {
			$old_value = array_key_exists($field, $asset) ? $asset[$field] : null;
			if ($field === 'metadata_json') {
				$old_value = $this->decode_json(isset($asset['metadata_json']) ? $asset['metadata_json'] : '', array());
			}
			$fields[] = array(
				'field' => $field,
				'oldValue' => $old_value,
				'newValue' => $new_value,
			);
		}
		return $fields;
	}

	private function text_length($value)
	{
		return function_exists('mb_strlen') ? mb_strlen((string) $value, 'UTF-8') : strlen((string) $value);
	}

	private function begin_transaction()
	{
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Asset mutations and audit events must commit together.
		return $wpdb->query('START TRANSACTION') !== false;
	}

	private function commit_transaction()
	{
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Asset mutations and audit events must commit together.
		return $wpdb->query('COMMIT') !== false;
	}

	private function rollback_transaction()
	{
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- Roll back every partial asset mutation.
		$wpdb->query('ROLLBACK');
		$this->assets->invalidate_cache();
	}

	private function rollback_error($code, $message, $status = 500)
	{
		$this->rollback_transaction();
		return Npcink_Device_Inventory_V3_Response::error($code, $message, $status);
	}

	private function validate_department($department)
	{
		$department = trim(sanitize_text_field((string) $department));
		if ($department === '') {
			return true;
		}
		if (in_array($department, $this->configured_departments(), true)) {
			return true;
		}
		return Npcink_Device_Inventory_V3_Response::error(
			'invalid_department',
			'请选择设置中已有的部门。',
			422
		);
	}

	private function configured_departments()
	{
		$raw_options = get_option(Npcink_Device_Inventory_V3_Tables::OPTION);
		if (is_array($raw_options) && array_key_exists('departments', $raw_options)) {
			return Npcink_Device_Inventory_V3_Tables::normalize_departments_with_default($raw_options['departments']);
		}
		return Npcink_Device_Inventory_V3_Tables::normalize_departments_with_default($this->asset_departments());
	}

	private function asset_departments()
	{
		global $wpdb;
		$table = Npcink_Device_Inventory_V3_Tables::assets();
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- One-time fallback reads current departments from the plugin-owned assets table when no department setting exists; caching would require invalidation on every asset write.
		$rows = $wpdb->get_col(
			$wpdb->prepare('SELECT DISTINCT department FROM %i WHERE department <> %s ORDER BY department ASC', $table, '')
		);
		if (!is_array($rows)) {
			return array();
		}
		return Npcink_Device_Inventory_V3_Tables::normalize_departments($rows);
	}

	private function asset_from_request($request)
	{
		$uuid = sanitize_text_field((string) $request['uuid']);
		$asset = $this->assets->find_by_uuid($uuid);
		if (!$asset) {
			return Npcink_Device_Inventory_V3_Response::error('asset_not_found', 'Asset not found.', 404);
		}
		return $asset;
	}

	public function format_asset($row)
	{
		if (!$row) {
			return null;
		}

		$item = array(
			'id' => intval($row['id']),
			'uuid' => (string) $row['uuid'],
			'assetType' => (string) $row['asset_type'],
			'assetNumber' => (string) $row['asset_number'],
			'name' => (string) $row['name'],
			'ownerName' => (string) $row['owner_name'],
			'department' => (string) $row['department'],
			'status' => (string) $row['status'],
			'category' => (string) $row['category'],
			'purchasePrice' => floatval($row['purchase_price']),
			'residualValue' => floatval($row['residual_value']),
			'metadata' => $this->decode_json(isset($row['metadata_json']) ? $row['metadata_json'] : '', array()),
			'createdAt' => (string) $row['created_at'],
			'updatedAt' => (string) $row['updated_at'],
		);
		if (array_key_exists('latest_summary_json', $row)) {
			$item['latestObservation'] = array(
				'summary' => $this->decode_json(isset($row['latest_summary_json']) ? $row['latest_summary_json'] : '', array()),
				'hardware' => $this->decode_json(isset($row['latest_hardware_json']) ? $row['latest_hardware_json'] : '', array()),
				'observedAt' => $this->format_utc_datetime(isset($row['latest_observed_at']) ? $row['latest_observed_at'] : ''),
				'source' => isset($row['latest_observation_source']) ? (string) $row['latest_observation_source'] : '',
			);
		}
		return $item;
	}

	private function format_identity($row)
	{
		return array(
			'id' => intval($row['id']),
			'assetId' => intval($row['asset_id']),
			'identityType' => (string) $row['identity_type'],
			'identityValue' => (string) $row['identity_value'],
			'confidence' => floatval($row['confidence']),
			'isPrimary' => intval($row['is_primary']) === 1,
			'source' => (string) $row['source'],
			'createdAt' => (string) $row['created_at'],
		);
	}

	private function format_observation($row)
	{
		$item = array(
			'id' => intval($row['id']),
			'assetId' => intval($row['asset_id']),
			'source' => (string) $row['source'],
			'schemaVersion' => intval($row['schema_version']),
			'observedAt' => $this->format_utc_datetime(isset($row['observed_at']) ? $row['observed_at'] : ''),
			'receivedAt' => (string) $row['received_at'],
			'summary' => $this->decode_json(isset($row['summary_json']) ? $row['summary_json'] : '', array()),
			'hardware' => $this->decode_json(isset($row['hardware_json']) ? $row['hardware_json'] : '', array()),
			'raw' => $this->decode_json(isset($row['raw_json']) ? $row['raw_json'] : '', array()),
		);
		if (isset($row['asset_uuid'])) {
			$item['asset'] = $this->format_asset_reference($row);
		}
		return $item;
	}

	private function format_event($row)
	{
		$item = array(
			'id' => intval($row['id']),
			'assetId' => isset($row['asset_id']) ? intval($row['asset_id']) : null,
			'eventSource' => (string) $row['event_source'],
			'eventType' => (string) $row['event_type'],
			'fieldName' => isset($row['field_name']) ? (string) $row['field_name'] : '',
			'oldValue' => isset($row['old_value']) ? (string) $row['old_value'] : '',
			'newValue' => isset($row['new_value']) ? (string) $row['new_value'] : '',
			'message' => isset($row['message']) ? (string) $row['message'] : '',
			'actorUserId' => isset($row['actor_user_id']) ? intval($row['actor_user_id']) : null,
			'actorName' => isset($row['actor_name']) ? (string) $row['actor_name'] : '',
			'payload' => $this->decode_json(isset($row['payload_json']) ? $row['payload_json'] : '', array()),
			'createdAt' => (string) $row['created_at'],
		);
		if (isset($row['asset_uuid'])) {
			$item['asset'] = $this->format_asset_reference($row);
		}
		return $item;
	}

	private function format_utc_datetime($value)
	{
		$value = trim((string) $value);
		if ($value === '') {
			return '';
		}
		return str_replace(' ', 'T', $value) . 'Z';
	}

	private function format_asset_reference($row)
	{
		return array(
			'uuid' => isset($row['asset_uuid']) ? (string) $row['asset_uuid'] : '',
			'assetNumber' => isset($row['asset_number']) ? (string) $row['asset_number'] : '',
			'name' => isset($row['asset_name']) ? (string) $row['asset_name'] : '',
			'assetType' => isset($row['asset_type']) ? (string) $row['asset_type'] : '',
			'status' => isset($row['status']) ? (string) $row['status'] : '',
			'department' => isset($row['department']) ? (string) $row['department'] : '',
			'ownerName' => isset($row['owner_name']) ? (string) $row['owner_name'] : '',
		);
	}

	private function decode_json($value, $fallback)
	{
		if (!is_string($value) || $value === '') {
			return $fallback;
		}

		$decoded = json_decode($value, true);
		if (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded)) {
			return $fallback;
		}

		return $decoded;
	}
}
