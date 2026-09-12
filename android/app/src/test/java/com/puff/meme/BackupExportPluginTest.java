package com.puff.meme;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class BackupExportPluginTest {
    private static final String ID = "a7cd3ce07a53707cb3192cf82da4cf522c7373196b70c17aef1291b251f46b99";

    @Test
    public void acceptsPureHashAndSupportedPhysicalExtensions() {
        assertEquals(ID, BackupExportPlugin.logicalImageId(ID));
        assertEquals(ID, BackupExportPlugin.logicalImageId(ID + ".webp"));
        assertEquals(ID, BackupExportPlugin.logicalImageId(ID + ".WEBP"));
        assertEquals(ID, BackupExportPlugin.logicalImageId(ID + ".png"));
        assertEquals(ID, BackupExportPlugin.logicalImageId(ID + ".jpg"));
        assertEquals(ID, BackupExportPlugin.logicalImageId(ID + ".jpeg"));
        assertEquals(ID, BackupExportPlugin.logicalImageId(ID + ".gif"));
        assertEquals(ID, BackupExportPlugin.logicalImageId(ID + ".avif"));
        assertEquals(ID, BackupExportPlugin.logicalImageId(ID + ".svg"));
        assertEquals("images/" + ID, BackupExportPlugin.canonicalZipImageEntry(ID + ".webp"));
        assertEquals("images/" + ID, BackupExportPlugin.canonicalZipImageEntry(ID));
    }

    @Test
    public void rejectsUnknownExtensionsAndInvalidBasenames() {
        assertNull(BackupExportPlugin.logicalImageId(ID + ".exe"));
        assertNull(BackupExportPlugin.logicalImageId("foo.webp"));
        assertNull(BackupExportPlugin.logicalImageId(ID.toUpperCase()));
        assertNull(BackupExportPlugin.logicalImageId(ID + ".webp.tmp"));
        assertNull(BackupExportPlugin.canonicalZipImageEntry(ID + ".exe"));
    }
}
