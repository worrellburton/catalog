package com.catalog.model;

public class Product {
    private String name;
    private String brand;
    private String price;
    private String url;

    public Product() {}

    public Product(String name, String brand, String price, String url) {
        this.name = name;
        this.brand = brand;
        this.price = price;
        this.url = url;
    }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getBrand() { return brand; }
    public void setBrand(String brand) { this.brand = brand; }

    public String getPrice() { return price; }
    public void setPrice(String price) { this.price = price; }

    public String getUrl() { return url; }
    public void setUrl(String url) { this.url = url; }
}
