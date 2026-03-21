package com.catalog.model;

public class Creator {
    private String handle;
    private String displayName;
    private String avatar;

    public Creator() {}

    public Creator(String handle, String displayName, String avatar) {
        this.handle = handle;
        this.displayName = displayName;
        this.avatar = avatar;
    }

    public String getHandle() { return handle; }
    public void setHandle(String handle) { this.handle = handle; }

    public String getDisplayName() { return displayName; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }

    public String getAvatar() { return avatar; }
    public void setAvatar(String avatar) { this.avatar = avatar; }
}
