import { X, Ruler } from '../ui/icons';
import './product.css';

export interface SizeGuideProps {
  category: string;
  isOpen: boolean;
  onClose: () => void;
}

export function SizeGuide({ category, isOpen, onClose }: SizeGuideProps) {
  if (!isOpen) return null;

  return (
    <div className="size-guide-backdrop" onClick={onClose}>
      <div
        className="size-guide-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Uniform Size Guide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="size-guide-header">
          <div className="size-guide-title-wrap">
            <Ruler width={22} height={22} strokeWidth={1.5} className="guide-icon" />
            <h3 className="size-guide-title">Uniform Size Guide</h3>
          </div>
          <button
            type="button"
            className="size-guide-close"
            aria-label="Close size guide"
            onClick={onClose}
          >
            <X width={22} height={22} strokeWidth={1.5} />
          </button>
        </div>

        <div className="size-guide-tip">
          <p>
            <strong>Growth allowance tip:</strong> School students grow rapidly through the academic year. If between sizes, choose one size up.
          </p>
        </div>

        <div className="size-guide-table-scroll">
          <table className="size-table">
            <thead>
              <tr>
                <th>Size Label</th>
                <th>Age Approx</th>
                <th>Height (cm)</th>
                <th>Chest (in)</th>
                <th>Waist (in)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>24</strong></td>
                <td>3 – 4 yrs</td>
                <td>98 – 104</td>
                <td>22 – 24</td>
                <td>20 – 21</td>
              </tr>
              <tr>
                <td><strong>26</strong></td>
                <td>5 – 6 yrs</td>
                <td>110 – 116</td>
                <td>24 – 26</td>
                <td>22 – 23</td>
              </tr>
              <tr>
                <td><strong>28</strong></td>
                <td>7 – 8 yrs</td>
                <td>122 – 128</td>
                <td>26 – 28</td>
                <td>23 – 24</td>
              </tr>
              <tr>
                <td><strong>30</strong></td>
                <td>9 – 10 yrs</td>
                <td>134 – 140</td>
                <td>28 – 30</td>
                <td>24 – 25</td>
              </tr>
              <tr>
                <td><strong>32</strong></td>
                <td>11 – 12 yrs</td>
                <td>146 – 152</td>
                <td>30 – 32</td>
                <td>26 – 27</td>
              </tr>
              <tr>
                <td><strong>34</strong></td>
                <td>13 – 14 yrs</td>
                <td>158 – 164</td>
                <td>32 – 34</td>
                <td>28 – 29</td>
              </tr>
              <tr>
                <td><strong>36</strong></td>
                <td>15+ yrs</td>
                <td>170+</td>
                <td>34 – 36</td>
                <td>30 – 31</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="size-guide-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Got it, return to product
          </button>
        </div>
      </div>
    </div>
  );
}
