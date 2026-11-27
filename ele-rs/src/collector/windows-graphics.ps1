# DXGI reports dedicated video memory as SIZE_T, unlike WMI's 32-bit AdapterRAM.
if ([IntPtr]::Size -ne 8) { throw 'DXGI inventory requires a 64-bit process' }
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class NpcinkDxgiInventory {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct AdapterDesc {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
        public uint VendorId, DeviceId, SubSysId, Revision;
        public UIntPtr DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
        public uint LuidLow;
        public int LuidHigh;
        public uint Flags;
    }
    public sealed class Adapter {
        public string Description;
        public uint VendorId, DeviceId, SubSysId, Revision, Flags;
        public ulong DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
        public string Luid;
    }
    [DllImport("dxgi.dll", ExactSpelling = true)]
    private static extern int CreateDXGIFactory1(ref Guid iid, out IntPtr factory);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int EnumAdapters1(IntPtr self, uint index, out IntPtr adapter);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetDesc1(IntPtr self, out AdapterDesc description);
    private static T Method<T>(IntPtr instance, int slot) where T : class {
        IntPtr table = Marshal.ReadIntPtr(instance);
        return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table, slot * IntPtr.Size), typeof(T));
    }
    public static Adapter[] Collect() {
        Guid iid = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
        IntPtr factory = IntPtr.Zero;
        var rows = new List<Adapter>();
        try {
            Marshal.ThrowExceptionForHR(CreateDXGIFactory1(ref iid, out factory));
            var enumerate = Method<EnumAdapters1>(factory, 12);
            for (uint index = 0; index < 128; index++) {
                IntPtr adapter;
                int result = enumerate(factory, index, out adapter);
                if (result == unchecked((int)0x887A0002)) break; // DXGI_ERROR_NOT_FOUND
                Marshal.ThrowExceptionForHR(result);
                try {
                    AdapterDesc d;
                    Marshal.ThrowExceptionForHR(Method<GetDesc1>(adapter, 10)(adapter, out d));
                    rows.Add(new Adapter {
                        Description = d.Description, VendorId = d.VendorId, DeviceId = d.DeviceId,
                        SubSysId = d.SubSysId, Revision = d.Revision, Flags = d.Flags,
                        DedicatedVideoMemory = d.DedicatedVideoMemory.ToUInt64(),
                        DedicatedSystemMemory = d.DedicatedSystemMemory.ToUInt64(),
                        SharedSystemMemory = d.SharedSystemMemory.ToUInt64(),
                        Luid = d.LuidHigh.ToString("X8") + d.LuidLow.ToString("X8")
                    });
                } finally { if (adapter != IntPtr.Zero) Marshal.Release(adapter); }
            }
        } finally { if (factory != IntPtr.Zero) Marshal.Release(factory); }
        return rows.ToArray();
    }
}
'@ -ErrorAction Stop
[NpcinkDxgiInventory]::Collect()
