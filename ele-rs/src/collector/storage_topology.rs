//! System-reported storage edges. Never infer relationships from capacities or names.
use super::{value_items, value_text, value_u64_at};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

fn id(value: &str) -> String {
    value.trim().to_ascii_uppercase()
}

fn unique_device(rows: &Value, field: &str, device: &str) -> usize {
    value_items(rows)
        .into_iter()
        .filter(|row| id(&value_text(row, field)) == id(device))
        .count()
}

fn drive_letter(mount: &str) -> Option<String> {
    let text = mount.trim_end_matches(['\\', '/']);
    let bytes = text.as_bytes();
    (bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':').then(|| id(text))
}

pub(super) fn enrich(root: &mut Map<String, Value>) {
    let raw = root.get("platformData").unwrap_or(&Value::Null);
    let source = |key: &str| raw.get(key).unwrap_or(&Value::Null);
    let disks = source("physical_disks");
    let partitions = source("disk_partitions");
    let disk_links = source("disk_partition_links");
    let volume_links = source("partition_volume_links");
    let attempts = root.get("hardwareProbeAttempts").and_then(Value::as_array);
    let ready = [
        "physical_disks",
        "disk_partitions",
        "disk_partition_links",
        "partition_volume_links",
    ]
    .iter()
    .all(|source| {
        attempts.is_some_and(|probes| {
            probes.iter().any(|p| {
                p["source"] == *source && matches!(p["status"].as_str(), Some("ok" | "empty"))
            })
        })
    });
    let partition_rows: Vec<_> = value_items(partitions).into_iter().filter(|row| row.is_object()).map(|row| json!({
        "partitionDevice": value_text(row, "DeviceID"), "diskIndex": value_u64_at(row, "DiskIndex"),
        "partitionIndex": value_u64_at(row, "Index"), "size": value_u64_at(row, "Size"),
        "startingOffsetBytes": value_u64_at(row, "StartingOffset"), "type": value_text(row, "Type"),
        "bootPartition": row.get("BootPartition"), "primaryPartition": row.get("PrimaryPartition"),
        "source": "Win32_DiskPartition",
    })).collect();
    let disk_edges: Vec<_> = value_items(disk_links).into_iter().filter(|row| row.is_object()).map(|row| {
        let disk = value_text(row, "diskDevice"); let partition = value_text(row, "partitionDevice");
        let disk_count = if disk.is_empty() { 0 } else { unique_device(disks, "DeviceID", &disk) };
        let partition_count = if partition.is_empty() { 0 } else { unique_device(partitions, "DeviceID", &partition) };
        let parent_count = value_items(disk_links).into_iter()
            .filter(|link| !partition.is_empty() && id(&value_text(link, "partitionDevice")) == id(&partition))
            .map(|link| id(&value_text(link, "diskDevice"))).collect::<BTreeSet<_>>().len();
        let status = if disk_count > 1 || partition_count > 1 || parent_count > 1 { "ambiguous" } else if disk_count == 1 && partition_count == 1 { "matched" } else { "unmapped" };
        json!({"diskDevice": disk, "partitionDevice": partition, "matchStatus": status, "source": "Win32_DiskDriveToDiskPartition"})
    }).collect();
    let volume_edges: Vec<_> = value_items(volume_links).into_iter().filter(|row| row.is_object()).map(|row| {
        let partition = value_text(row, "partitionDevice");
        let volume = value_text(row, "volumeDevice");
        let count = if partition.is_empty() { 0 } else { unique_device(partitions, "DeviceID", &partition) };
        json!({"partitionDevice": partition, "volumeDevice": volume,
            "startingAddressBytes": value_u64_at(row, "StartingAddress"), "endingAddressBytes": value_u64_at(row, "EndingAddress"),
            "matchStatus": if count > 1 { "ambiguous" } else if count == 1 && drive_letter(&volume).is_some() { "matched" } else { "unmapped" },
            "source": "Win32_LogicalDiskToPartition"})
    }).collect();
    let mappings: Vec<_> = root.get("fsSize").map(value_items).unwrap_or_default().into_iter().filter(|row| row.is_object()).map(|volume| {
        let mount = value_text(volume, "mount");
        let letter = drive_letter(&mount);
        let mut physical = BTreeSet::new(); let mut partition_ids = BTreeSet::new(); let mut ambiguous = false; let mut unresolved = false;
        for edge in &volume_edges {
            if letter.as_ref().is_some_and(|letter| id(&value_text(edge, "volumeDevice")) == *letter) {
                let partition = value_text(edge, "partitionDevice");
                partition_ids.insert(partition.clone());
                ambiguous |= edge["matchStatus"] == "ambiguous";
                unresolved |= edge["matchStatus"] != "matched";
                let parents: Vec<_> = disk_edges.iter().filter(|edge| id(&value_text(edge, "partitionDevice")) == id(&partition)).collect();
                unresolved |= parents.is_empty();
                // A partition cannot belong to two physical disk endpoints.
                ambiguous |= parents.iter().map(|parent| id(&value_text(parent, "diskDevice"))).collect::<BTreeSet<_>>().len() > 1;
                for parent in parents {
                    ambiguous |= parent["matchStatus"] == "ambiguous";
                    unresolved |= parent["matchStatus"] != "matched";
                    if !ambiguous && parent["matchStatus"] == "matched" { physical.insert(value_text(parent, "diskDevice")); }
                }
            }
        }
        if ambiguous { physical.clear(); }
        let status = if ambiguous { "ambiguous" } else if !unresolved && !physical.is_empty() { "matched" } else { "unmapped" };
        json!({"mount": mount, "volumeDevice": letter, "diskDevices": physical, "partitionDevices": partition_ids,
            "matchStatus": status, "reason": if ambiguous { Some("duplicate_identifier") } else if status == "matched" { None } else if !ready { Some("source_unavailable") } else if letter.is_none() { Some("unsupported_mount_path") } else { Some("no_association") },
            "source": "Win32_DiskDriveToDiskPartition + Win32_LogicalDiskToPartition"})
    }).collect();
    let health_mappings: Vec<_> = value_items(source("storage_health")).into_iter().enumerate().filter(|(_, row)| row.is_object()).map(|(index, counter)| {
        let uid = value_text(counter, "StorageUniqueId");
        let devices: Vec<_> = value_items(source("storage_devices")).into_iter().filter(|device| !uid.is_empty() && value_text(device, "UniqueId") == uid).collect();
        let matched = (devices.len() == 1).then(|| devices[0]);
        json!({"healthRecordIndex": index, "storageUniqueId": uid,
            "storageDeviceName": matched.map(|device| value_text(device, "FriendlyName")),
            "storageSerialNumber": matched.map(|device| value_text(device, "SerialNumber")),
            "matchStatus": if devices.len() > 1 { "ambiguous" } else if matched.is_some() { "matched" } else { "unmapped" },
            "source": "Get-PhysicalDisk.UniqueId / Get-StorageReliabilityCounter"})
    }).collect();
    let orphan_partition = partition_rows.iter().any(|partition| {
        !disk_edges.iter().any(|edge| {
            edge["matchStatus"] == "matched"
                && id(&value_text(edge, "partitionDevice"))
                    == id(&value_text(partition, "partitionDevice"))
        })
    });
    let incomplete = orphan_partition
        || mappings
            .iter()
            .chain(disk_edges.iter())
            .chain(volume_edges.iter())
            .any(|row| row["matchStatus"] != "matched");
    let topology = json!({"source": "Windows CIM associations", "status": if partition_rows.is_empty() && disk_edges.is_empty() && volume_edges.is_empty() { "unavailable" } else if ready && !incomplete { "complete" } else { "partial" },
        "partitions": partition_rows, "diskPartitions": disk_edges, "partitionVolumes": volume_edges, "volumeMappings": mappings});
    let storage = root.entry("storage").or_insert_with(|| json!({}));
    storage["topology"] = topology;
    storage["healthMappings"] = json!(health_mappings);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Map<String, Value> {
        json!({"fsSize":[{"mount":"C:\\", "size":100}, {"mount":"D:\\", "size":100}, {"mount":"E:\\", "size":100}],
            "platformData": {
                "physical_disks":[{"DeviceID":"disk-b", "Size":100}, {"DeviceID":"disk-a", "Size":100}],
                "disk_partitions":[{"DeviceID":"part-b", "Size":100}, {"DeviceID":"part-a", "Size":50}],
                "disk_partition_links":[{"diskDevice":"disk-a", "partitionDevice":"part-a"}, {"diskDevice":"disk-b", "partitionDevice":"part-b"}],
                "partition_volume_links":[{"partitionDevice":"part-a", "volumeDevice":"C:"}, {"partitionDevice":"part-a", "volumeDevice":"D:"}, {"partitionDevice":"part-a", "volumeDevice":"E:"}, {"partitionDevice":"part-b", "volumeDevice":"E:"}],
                "storage_devices":[{"UniqueId":"id-a", "FriendlyName":"Same model", "SerialNumber":"serial-a"}, {"UniqueId":"id-b", "FriendlyName":"Same model", "SerialNumber":"serial-b"}],
                "storage_health":[{"StorageUniqueId":"id-b", "Temperature":32}]
            }, "hardwareProbeAttempts": (["physical_disks","disk_partitions","disk_partition_links","partition_volume_links"].map(|source| json!({"source":source,"status":"ok"})))
        }).as_object().unwrap().clone()
    }

    #[test]
    fn maps_multiple_volumes_and_spanned_volume_by_associations_not_capacity_or_order() {
        let mut root = fixture();
        let before = root["platformData"].clone();
        enrich(&mut root);
        let topology = &root["storage"]["topology"];
        assert_eq!(topology["status"], "complete");
        assert_eq!(
            topology["volumeMappings"][0]["diskDevices"],
            json!(["disk-a"])
        );
        assert_eq!(
            topology["volumeMappings"][1]["diskDevices"],
            json!(["disk-a"])
        );
        assert_eq!(
            topology["volumeMappings"][2]["diskDevices"],
            json!(["disk-a", "disk-b"])
        );
        assert_eq!(
            root["storage"]["healthMappings"][0]["storageSerialNumber"],
            "serial-b"
        );
        assert_eq!(root["platformData"], before);
    }

    #[test]
    fn missing_ambiguous_or_incomplete_sources_never_invent_disk_ownership() {
        let mut root = fixture();
        root["platformData"]["disk_partition_links"] = json!([]);
        root["hardwareProbeAttempts"][2]["status"] = json!("failed");
        enrich(&mut root);
        assert_eq!(
            root["storage"]["topology"]["volumeMappings"][0]["matchStatus"],
            "unmapped"
        );
        assert_eq!(
            root["storage"]["topology"]["volumeMappings"][0]["diskDevices"],
            json!([])
        );
        assert_eq!(
            root["storage"]["topology"]["volumeMappings"][0]["reason"],
            "source_unavailable"
        );
        let mut root = fixture();
        root["platformData"]["physical_disks"] =
            json!([{"DeviceID":"disk-a"}, {"DeviceID":"DISK-A"}]);
        enrich(&mut root);
        assert_eq!(
            root["storage"]["topology"]["volumeMappings"][0]["matchStatus"],
            "ambiguous"
        );
        assert_eq!(
            root["storage"]["topology"]["volumeMappings"][0]["diskDevices"],
            json!([])
        );
        let mut orphan = fixture();
        orphan["platformData"]["disk_partition_links"] = json!([]);
        orphan["platformData"]["partition_volume_links"] = json!([]);
        orphan["fsSize"] = json!([]);
        enrich(&mut orphan);
        assert_eq!(orphan["storage"]["topology"]["status"], "partial");
        assert_eq!(drive_letter("C:\\mounted-folder\\"), None);
        assert_eq!(drive_letter("/dev/disk1s2"), None);
    }

    #[test]
    fn contradictory_partition_parents_and_sparse_health_keep_uncertainty() {
        let mut root = fixture();
        root["platformData"]["disk_partition_links"]
            .as_array_mut()
            .unwrap()
            .push(json!({"diskDevice":"disk-b", "partitionDevice":"part-a"}));
        root["platformData"]["storage_health"] = json!([null, {"StorageUniqueId":"id-a"}]);
        enrich(&mut root);
        assert_eq!(
            root["storage"]["topology"]["volumeMappings"][0]["matchStatus"],
            "ambiguous"
        );
        assert_eq!(
            root["storage"]["topology"]["volumeMappings"][0]["diskDevices"],
            json!([])
        );
        assert_eq!(root["storage"]["healthMappings"][0]["healthRecordIndex"], 1);
        assert_eq!(
            root["storage"]["healthMappings"][0]["storageSerialNumber"],
            "serial-a"
        );
    }

    #[test]
    fn missing_health_identifier_does_not_match_same_model_or_numeric_index() {
        let mut root = fixture();
        root["platformData"]["storage_health"] =
            json!([{"DeviceId":0,"Temperature":30}, {"StorageUniqueId":"missing"}]);
        enrich(&mut root);
        assert!(root["storage"]["healthMappings"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["matchStatus"] == "unmapped" && row["storageSerialNumber"].is_null()));
    }
}
