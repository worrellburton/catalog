package com.catalog.controller;

import com.catalog.model.Creator;
import com.catalog.model.Look;
import com.catalog.model.Product;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;

import java.util.ArrayList;
import java.util.List;

@Controller
public class HomeController {

    private static final Creator LILY = new Creator(
            "@lilywittman", "Lily Wittman", "https://i.pravatar.cc/100?img=47");
    private static final Creator GARRETT = new Creator(
            "@garrett", "Garrett", "https://i.pravatar.cc/100?img=12");

    private static final List<Product> GIRL_PRODUCTS = List.of(
            new Product("Rock Style Flap Shoulder Bag", "Zara", "$49", "https://www.zara.com"),
            new Product("Major Shade Cat Eye Sunglasses", "Windsor", "$10", "https://www.windsorstore.com"),
            new Product("Oval D Glitter Case for iPhone 16 Pro", "Diesel", "$39", "https://www.diesel.com"),
            new Product("Cross Pendant Necklace", "Pavoi", "$13", "https://www.pavoi.com")
    );

    private static final List<Product> GUY_PRODUCTS = List.of(
            new Product("Patchwork Pointelle Short-Sleeve Shirt", "Vince", "$568", "https://www.vince.com"),
            new Product("Light Blue Straight Leg Jeans", "Suitsupply", "$199", "https://suitsupply.com"),
            new Product("B27 Uptown Low-Top Sneaker", "Dior", "$1,200", "https://www.dior.com"),
            new Product("Digital Camera", "Fujifilm", "$1,725", "https://www.fujifilm.com")
    );

    private static final String[] DESCRIPTIONS = {
            "A curated selection of essential pieces for the modern wardrobe.",
            "Effortless layering with neutral tones and soft textures.",
            "Sharp tailoring meets relaxed silhouettes.",
            "Minimalist elegance with bold accessories.",
            "Weekend ready with refined casual pieces.",
            "Evening allure with timeless sophistication.",
            "Transitional dressing for in-between seasons.",
            "Monochrome mastery with textural contrast.",
            "Artful draping and fluid movement.",
            "Power dressing reimagined for today.",
            "Soft palette with unexpected proportions.",
            "Polished ease for every occasion."
    };

    private static final String[] COLORS = {
            "#c4a882", "#8b9e8b", "#a89090", "#8899aa", "#b8a898", "#787878",
            "#9ca88c", "#a09088", "#8a8a9e", "#aa9e88", "#9e8a7e", "#7e8e8e"
    };

    @GetMapping("/")
    public String home(Model model) {
        List<Look> looks = new ArrayList<>();
        for (int i = 1; i <= 12; i++) {
            boolean isWomen = (i % 2 == 1);
            looks.add(new Look(
                    i,
                    String.format("Look %02d", i),
                    isWomen ? "girl2.mp4" : "guy.mp4",
                    isWomen ? "women" : "men",
                    DESCRIPTIONS[i - 1],
                    COLORS[i - 1],
                    isWomen ? LILY : GARRETT,
                    isWomen ? GIRL_PRODUCTS : GUY_PRODUCTS
            ));
        }
        model.addAttribute("looks", looks);
        return "index";
    }
}
