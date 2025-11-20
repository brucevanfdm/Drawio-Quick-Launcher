from PIL import Image
import os

def generate_icons(source_file):
    if not os.path.exists(source_file):
        print(f"Error: {source_file} not found.")
        return

    try:
        img = Image.open(source_file)
        sizes = [16, 48, 128]
        
        for size in sizes:
            resized_img = img.resize((size, size), Image.Resampling.LANCZOS)
            output_filename = f"icon{size}.png"
            resized_img.save(output_filename)
            print(f"Generated {output_filename}")
            
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    generate_icons("icon.png")
