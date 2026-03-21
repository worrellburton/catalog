package com.catalog.model;

import java.util.List;

public class Look {
    private int id;
    private String title;
    private String video;
    private String gender;
    private String description;
    private String color;
    private Creator creator;
    private List<Product> products;
    private String productsJson;

    public Look() {}

    public Look(int id, String title, String video, String gender, String description,
                String color, Creator creator, List<Product> products) {
        this.id = id;
        this.title = title;
        this.video = video;
        this.gender = gender;
        this.description = description;
        this.color = color;
        this.creator = creator;
        this.products = products;
        this.productsJson = buildProductsJson(products);
    }

    private static String buildProductsJson(List<Product> products) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < products.size(); i++) {
            Product p = products.get(i);
            if (i > 0) sb.append(",");
            sb.append("{\"name\":\"").append(escapeJson(p.getName()))
              .append("\",\"brand\":\"").append(escapeJson(p.getBrand()))
              .append("\",\"price\":\"").append(escapeJson(p.getPrice()))
              .append("\",\"url\":\"").append(escapeJson(p.getUrl()))
              .append("\"}");
        }
        sb.append("]");
        return sb.toString();
    }

    private static String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public int getId() { return id; }
    public void setId(int id) { this.id = id; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getVideo() { return video; }
    public void setVideo(String video) { this.video = video; }

    public String getGender() { return gender; }
    public void setGender(String gender) { this.gender = gender; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public String getColor() { return color; }
    public void setColor(String color) { this.color = color; }

    public Creator getCreator() { return creator; }
    public void setCreator(Creator creator) { this.creator = creator; }

    public List<Product> getProducts() { return products; }
    public void setProducts(List<Product> products) { this.products = products; }

    public String getProductsJson() { return productsJson; }
    public void setProductsJson(String productsJson) { this.productsJson = productsJson; }
}
